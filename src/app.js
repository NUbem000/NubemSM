require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const speedTest = require('speedtest-net');
const winston = require('winston');
const { format } = winston;
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

// Import middleware
const { applyRateLimit } = require('./middleware/rateLimiter');
const { authenticate, authorize, login, generateUserApiKey } = require('./middleware/auth');

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

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// CORS configuration
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing and compression
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// Apply rate limiting
app.use(applyRateLimit);

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent')
    });
    next();
});

// Database configuration
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

pool.on('error', (err) => {
    logger.error('Unexpected error on idle database client', err);
});

// Metrics
let testCount = 0;
let errorCount = 0;
let lastTestResult = null;

// Public endpoints (no auth required)
app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        
        res.json({ 
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '2.0.0'
        });
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({ 
            status: 'unhealthy',
            error: error.message 
        });
    }
});

app.get('/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(`# HELP speedtest_runs_total Total number of speed tests run
# TYPE speedtest_runs_total counter
speedtest_runs_total ${testCount}

# HELP speedtest_errors_total Total number of speed test errors
# TYPE speedtest_errors_total counter
speedtest_errors_total ${errorCount}

# HELP speedtest_last_download_mbps Last download speed in Mbps
# TYPE speedtest_last_download_mbps gauge
speedtest_last_download_mbps ${lastTestResult?.download || 0}

# HELP speedtest_last_upload_mbps Last upload speed in Mbps
# TYPE speedtest_last_upload_mbps gauge
speedtest_last_upload_mbps ${lastTestResult?.upload || 0}

# HELP speedtest_last_latency_ms Last latency in milliseconds
# TYPE speedtest_last_latency_ms gauge
speedtest_last_latency_ms ${lastTestResult?.latency || 0}

# HELP nodejs_heap_size_used_bytes Process heap size from Node.js
# TYPE nodejs_heap_size_used_bytes gauge
nodejs_heap_size_used_bytes ${process.memoryUsage().heapUsed}

# HELP nodejs_heap_size_total_bytes Process total heap size from Node.js
# TYPE nodejs_heap_size_total_bytes gauge
nodejs_heap_size_total_bytes ${process.memoryUsage().heapTotal}

# HELP nodejs_external_memory_bytes Process external memory from Node.js
# TYPE nodejs_external_memory_bytes gauge
nodejs_external_memory_bytes ${process.memoryUsage().external}

# HELP process_uptime_seconds Process uptime in seconds
# TYPE process_uptime_seconds gauge
process_uptime_seconds ${process.uptime()}
`);
});

// Authentication endpoints
app.post('/auth/login', login);

// Protected API endpoints
app.get('/api/status', authenticate, async (req, res) => {
    try {
        const client = await pool.connect();
        
        // Get latest test result
        const latestResult = await client.query(
            'SELECT * FROM speedtest_results ORDER BY timestamp DESC LIMIT 1'
        );
        
        // Get statistics
        const stats = await client.query(`
            SELECT 
                COUNT(*) as total_tests,
                AVG(download_speed / 125000) as avg_download_mbps,
                AVG(upload_speed / 125000) as avg_upload_mbps,
                AVG(latency) as avg_latency_ms,
                MIN(download_speed / 125000) as min_download_mbps,
                MAX(download_speed / 125000) as max_download_mbps
            FROM speedtest_results
            WHERE timestamp > NOW() - INTERVAL '24 hours'
        `);
        
        client.release();
        
        res.json({
            latest: latestResult.rows[0],
            stats: stats.rows[0],
            uptime: process.uptime(),
            testCount,
            errorCount
        });
    } catch (error) {
        logger.error('API status error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});

app.get('/api/history', authenticate, async (req, res) => {
    const { hours = 24, limit = 1000 } = req.query;
    
    try {
        const client = await pool.connect();
        const result = await client.query(
            `SELECT 
                id,
                download_speed / 125000 as download_mbps,
                upload_speed / 125000 as upload_mbps,
                latency,
                server_name,
                server_location,
                timestamp
            FROM speedtest_results 
            WHERE timestamp > NOW() - INTERVAL '${parseInt(hours)} hours'
            ORDER BY timestamp DESC
            LIMIT ${parseInt(limit)}`
        );
        client.release();
        
        res.json({
            data: result.rows,
            count: result.rowCount
        });
    } catch (error) {
        logger.error('API history error:', error);
        res.status(500).json({ error: 'Failed to get history' });
    }
});

// Admin endpoints
app.post('/api/keys', authenticate, authorize('admin'), generateUserApiKey);

app.post('/api/test/trigger', authenticate, authorize('admin'), async (req, res) => {
    try {
        res.json({ message: 'Speed test triggered', id: Date.now() });
        
        // Run test asynchronously
        performSpeedTest().catch(error => {
            logger.error('Triggered test failed:', error);
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to trigger test' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Speed test functions
async function runSpeedTest(retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            logger.info(`Running speed test (attempt ${attempt}/${retries})...`);
            const startTime = Date.now();
            
            const test = await speedTest({ 
                acceptGdpr: true, 
                acceptLicense: true,
                serverId: process.env.SPEEDTEST_SERVER_ID
            });
            
            const duration = Date.now() - startTime;
            const downloadMbps = (test.download.bandwidth / 125000).toFixed(2);
            const uploadMbps = (test.upload.bandwidth / 125000).toFixed(2);
            const latencyMs = test.ping.latency.toFixed(2);
            
            logger.info(`Speed test completed in ${duration}ms`, {
                download: `${downloadMbps} Mbps`,
                upload: `${uploadMbps} Mbps`,
                ping: `${latencyMs} ms`,
                server: test.server.name
            });
            
            lastTestResult = {
                download: downloadMbps,
                upload: uploadMbps,
                latency: latencyMs
            };
            
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

async function performSpeedTest() {
    try {
        const test = await runSpeedTest();
        await saveTestResult(test);
    } catch (error) {
        errorCount++;
        logger.error('Failed to complete speed test cycle:', error);
        
        if (errorCount > 5) {
            logger.error('CRITICAL: Too many consecutive failures');
        }
    }
}

// Configuration validation
const speedtestInterval = parseInt(process.env.SPEEDTEST_INTERVAL);
if (isNaN(speedtestInterval) || speedtestInterval < 60000) {
    logger.error('Invalid SPEEDTEST_INTERVAL. Must be at least 60000ms (1 minute)');
    process.exit(1);
}

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
    logger.info(`Speed tests will run every ${speedtestInterval/60000} minutes`);
});

// Schedule speed tests
setTimeout(performSpeedTest, 5000);
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
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    shutdown();
});

module.exports = app;