const speedTest = require('speedtest-net');

exports.runSpeedTest = async (pool) => {
    try {
        const test = await speedTest({ acceptGdpr: true, acceptLicense: true });
        const client = await pool.connect();
        const insertQuery = 'INSERT INTO speedtest_results(download_speed, upload_speed, latency) VALUES($1, $2, $3)';
        const values = [test.download.bandwidth, test.upload.bandwidth, test.ping.latency];
        await client.query(insertQuery, values);
        client.release();
    } catch (error) {
        console.error('Error running speed test:', error);
    }
};
