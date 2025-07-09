const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

// Create Redis client
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

// Handle Redis connection errors
redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// Create different rate limiters for different endpoints
const createRateLimiter = (options) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too many requests',
        message: 'Please try again later',
        retryAfter: Math.round(options.windowMs / 1000)
      });
    }
  };

  // Use Redis store if available, otherwise use memory store
  if (redisClient.status === 'ready') {
    return rateLimit({
      ...defaultOptions,
      ...options,
      store: new RedisStore({
        client: redisClient,
        prefix: 'rl:'
      })
    });
  }

  return rateLimit({
    ...defaultOptions,
    ...options
  });
};

// Rate limiters for different endpoints
const rateLimiters = {
  // Health check - very permissive
  health: createRateLimiter({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    skipSuccessfulRequests: true
  }),

  // Metrics endpoint - moderate
  metrics: createRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 30, // 30 requests per 5 minutes
    skipSuccessfulRequests: false
  }),

  // API endpoints - strict
  api: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes
    skipFailedRequests: false
  }),

  // Admin endpoints - very strict
  admin: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per 15 minutes
    skipFailedRequests: false
  }),

  // Global rate limiter
  global: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes
    skipSuccessfulRequests: false,
    keyGenerator: (req) => {
      // Use IP address as key
      return req.ip || req.connection.remoteAddress;
    }
  })
};

// Middleware to apply rate limiting based on path
const applyRateLimit = (req, res, next) => {
  const path = req.path;

  if (path === '/health') {
    return rateLimiters.health(req, res, next);
  } else if (path === '/metrics') {
    return rateLimiters.metrics(req, res, next);
  } else if (path.startsWith('/api/')) {
    return rateLimiters.api(req, res, next);
  } else if (path.startsWith('/admin/')) {
    return rateLimiters.admin(req, res, next);
  } else {
    return rateLimiters.global(req, res, next);
  }
};

module.exports = {
  rateLimiters,
  applyRateLimit,
  redisClient
};