require('dotenv').config();
const { Pool } = require('pg');
const speedTest = require('speedtest-net');
const winston = require('winston');
const { format } = winston;

// Configure logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: { service: 'speed-monitor' },
    transports: [
        new winston.transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        }),
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log' 
        })
    ]
});

// Database configuration with connection pooling
const poolConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT) || 5432,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

const pool = new Pool(poolConfig);

// Graceful error handling
pool.on('error', (err) => {
    logger.error('Unexpected error on idle database client', err);
});

// Health check endpoint
const http = require('http');
const server = http.createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                status: 'healthy',
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            }));
        } catch (error) {
            logger.error('Health check failed:', error);
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                status: 'unhealthy',
                error: error.message 
            }));
        }
    } else if (req.url === '/metrics' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`# HELP speedtest_runs_total Total number of speed tests run
# TYPE speedtest_runs_total counter
speedtest_runs_total ${testCount}

# HELP speedtest_errors_total Total number of speed test errors
# TYPE speedtest_errors_total counter
speedtest_errors_total ${errorCount}

# HELP nodejs_heap_size_used_bytes Process heap size from Node.js
# TYPE nodejs_heap_size_used_bytes gauge
nodejs_heap_size_used_bytes ${process.memoryUsage().heapUsed}
`);
    } else {
        res.writeHead(404);
        res.end();
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Health check server listening on port ${PORT}`);
});

// Metrics
let testCount = 0;
let errorCount = 0;

// Configuration validation
const speedtestInterval = parseInt(process.env.SPEEDTEST_INTERVAL);
if (isNaN(speedtestInterval) || speedtestInterval < 60000) {
    logger.error('Invalid SPEEDTEST_INTERVAL. Must be at least 60000ms (1 minute)');
    process.exit(1);
}

logger.info(`Speed monitor starting. Tests will run every ${speedtestInterval/60000} minutes`);

// Speed test with retry logic
async function runSpeedTest(retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger.info(`Running speed test (attempt ${attempt}/${retries})...`);
            const startTime = Date.now();
            
            const test = await speedTest({ 
                acceptGdpr: true, 
                acceptLicense: true,
                serverId: process.env.SPEEDTEST_SERVER_ID // Optional: use specific server
            });
            
            const duration = Date.now() - startTime;
            logger.info(`Speed test completed in ${duration}ms`, {
                download: `${(test.download.bandwidth / 125000).toFixed(2)} Mbps`,
                upload: `${(test.upload.bandwidth / 125000).toFixed(2)} Mbps`,
                ping: `${test.ping.latency.toFixed(2)} ms`,
                server: test.server.name
            });
            
            return test;
        } catch (error) {
            logger.error(`Speed test attempt ${attempt} failed:`, error);
            if (attempt === retries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
        }
    }
}

// Database operations with transaction
async function saveTestResult(test) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const insertQuery = `
            INSERT INTO speedtest_results(
                download_speed, 
                upload_speed, 
                latency,
                server_id,
                server_name,
                server_location,
                server_country,
                server_host,
                server_ip,
                result_url,
                packet_loss
            ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
        `;
        
        const values = [
            test.download.bandwidth,
            test.upload.bandwidth,
            test.ping.latency,
            test.server.id,
            test.server.name,
            test.server.location,
            test.server.country,
            test.server.host,
            test.server.ip,
            test.result?.url || null,
            test.packetLoss || 0
        ];
        
        const result = await client.query(insertQuery, values);
        await client.query('COMMIT');
        
        logger.info(`Test result saved with ID: ${result.rows[0].id}`);
        testCount++;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Main test loop
async function performSpeedTest() {
    try {
        const test = await runSpeedTest();
        await saveTestResult(test);
    } catch (error) {
        errorCount++;
        logger.error('Failed to complete speed test cycle:', error);
        
        // Alert on consecutive failures
        if (errorCount > 5) {
            logger.error('CRITICAL: Too many consecutive failures');
        }
    }
}

// Initial test on startup
setTimeout(performSpeedTest, 5000);

// Schedule regular tests
const testInterval = setInterval(performSpeedTest, speedtestInterval);

// Graceful shutdown
async function shutdown() {
    logger.info('Shutting down gracefully...');
    clearInterval(testInterval);
    server.close();
    await pool.end();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    shutdown();
});