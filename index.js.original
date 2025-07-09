require('dotenv').config();
const { Pool } = require('pg');
const speedTest = require('speedtest-net');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: 5432,
});

const speedtestInterval = parseInt(process.env.SPEEDTEST_INTERVAL);
console.log(`SpeedTest will run every ${speedtestInterval/60000} minutes`);

setInterval(async () => {
    try {
        const test = await speedTest({ acceptGdpr: true, acceptLicense: true });
        const client = await pool.connect();
        const insertQuery = 'INSERT INTO speedtest_results(download_speed, upload_speed, latency) VALUES($1, $2, $3)';
        const values = [test.download.bandwidth, test.upload.bandwidth, test.ping.latency];
        await client.query(insertQuery, values);
        client.release();
    } catch (error) {
        console.error('Error running speed test: ', error);
    }
}, speedtestInterval);
