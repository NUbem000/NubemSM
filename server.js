require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const speedTest = require('./speedtest');

const app = express();
const port = 3000;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: 5432,
});

const speedtestInterval = parseInt(process.env.SPEEDTEST_INTERVAL);

setInterval(() => {
    speedTest.runSpeedTest(pool);
}, speedtestInterval);

app.get('/data', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM speedtest_results ORDER BY timestamp DESC LIMIT 10;');
        res.json(result.rows);
    } finally {
        client.release();
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
