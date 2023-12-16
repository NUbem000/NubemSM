require('dotenv').config();
const { Pool } = require('pg');
const speedTest = require('./speedtest');

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
    console.log(`[${new Date().toISOString()}] Starting SpeedTest...`)
    await speedTest.runSpeedTest(pool);
    console.log(`[${new Date().toISOString()}] SpeedTest Data Saved`)
}, speedtestInterval);
