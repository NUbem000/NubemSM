const request = require('supertest');
const { Pool } = require('pg');

// Mock dependencies
jest.mock('pg');
jest.mock('speedtest-net');
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn()
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn()
  }
}));

describe('Speed Monitor', () => {
  let server;
  let mockPool;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock environment variables
    process.env.SPEEDTEST_INTERVAL = '300000';
    process.env.DB_USER = 'testuser';
    process.env.DB_PASSWORD = 'testpass';
    process.env.DB_NAME = 'testdb';
    process.env.DB_HOST = 'localhost';
    
    // Mock pool
    mockPool = {
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn()
    };
    Pool.mockImplementation(() => mockPool);
  });

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  describe('Health Check Endpoint', () => {
    it('should return healthy status when database is accessible', async () => {
      // Mock successful database connection
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
        release: jest.fn()
      };
      mockPool.connect.mockResolvedValue(mockClient);

      // Import and start the server
      const app = require('../index');
      
      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await request(`http://localhost:${process.env.PORT || 3000}`)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        uptime: expect.any(Number),
        timestamp: expect.any(String)
      });
    });

    it('should return unhealthy status when database is not accessible', async () => {
      // Mock database connection failure
      mockPool.connect.mockRejectedValue(new Error('Connection refused'));

      // Import and start the server
      const app = require('../index');
      
      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await request(`http://localhost:${process.env.PORT || 3000}`)
        .get('/health')
        .expect(503);

      expect(response.body).toMatchObject({
        status: 'unhealthy',
        error: 'Connection refused'
      });
    });
  });

  describe('Metrics Endpoint', () => {
    it('should return Prometheus-formatted metrics', async () => {
      // Import and start the server
      const app = require('../index');
      
      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await request(`http://localhost:${process.env.PORT || 3000}`)
        .get('/metrics')
        .expect(200)
        .expect('Content-Type', 'text/plain');

      expect(response.text).toContain('speedtest_runs_total');
      expect(response.text).toContain('speedtest_errors_total');
      expect(response.text).toContain('nodejs_heap_size_used_bytes');
    });
  });

  describe('Configuration Validation', () => {
    it('should exit if SPEEDTEST_INTERVAL is invalid', () => {
      process.env.SPEEDTEST_INTERVAL = '30000'; // Less than 1 minute
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      
      // Re-require to trigger validation
      jest.resetModules();
      require('../index');

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});

describe('Speed Test Functionality', () => {
  const speedTest = require('speedtest-net');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully run a speed test', async () => {
    const mockTestResult = {
      download: { bandwidth: 100000000 }, // 100 Mbps in bits
      upload: { bandwidth: 50000000 }, // 50 Mbps in bits
      ping: { latency: 20 },
      server: {
        id: 1234,
        name: 'Test Server',
        location: 'Test City',
        country: 'Test Country',
        host: 'test.server.com',
        ip: '1.2.3.4'
      },
      result: { url: 'https://speedtest.net/result/12345' },
      packetLoss: 0
    };

    speedTest.mockResolvedValue(mockTestResult);

    // Import the runSpeedTest function
    jest.resetModules();
    const { runSpeedTest } = require('../index');

    const result = await runSpeedTest();
    
    expect(result).toEqual(mockTestResult);
    expect(speedTest).toHaveBeenCalledWith({
      acceptGdpr: true,
      acceptLicense: true,
      serverId: undefined
    });
  });

  it('should retry on failure', async () => {
    speedTest
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce({
        download: { bandwidth: 100000000 },
        upload: { bandwidth: 50000000 },
        ping: { latency: 20 },
        server: { name: 'Test Server' }
      });

    jest.resetModules();
    const { runSpeedTest } = require('../index');

    const result = await runSpeedTest();
    
    expect(speedTest).toHaveBeenCalledTimes(3);
    expect(result).toBeDefined();
  });
});