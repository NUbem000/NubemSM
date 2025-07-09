const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-this';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// Database pool for user management
const authPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 5432
});

// Initialize auth tables
async function initializeAuthTables() {
  try {
    await authPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'viewer',
        api_key VARCHAR(255) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        key_hash VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        permissions JSONB DEFAULT '{}',
        last_used TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      );

      CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
    `);

    // Create default admin user if doesn't exist
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123!';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@nubem.dev';

    const userExists = await authPool.query(
      'SELECT id FROM users WHERE username = $1',
      [adminUsername]
    );

    if (userExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await authPool.query(
        'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        [adminUsername, adminEmail, hashedPassword, 'admin']
      );
      console.log('Default admin user created');
    }
  } catch (error) {
    console.error('Error initializing auth tables:', error);
  }
}

// Initialize on module load
initializeAuthTables();

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

// Generate API key
function generateApiKey() {
  const prefix = 'sm_';
  const randomBytes = require('crypto').randomBytes(32).toString('hex');
  return `${prefix}${randomBytes}`;
}

// Hash API key for storage
async function hashApiKey(apiKey) {
  return bcrypt.hash(apiKey, 10);
}

// Verify JWT token middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Verify API key middleware
const verifyApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'No API key provided' });
  }

  try {
    // Check if API key exists and is active
    const keyHash = await bcrypt.hash(apiKey, 10);
    const result = await authPool.query(`
      SELECT k.*, u.username, u.role, u.email 
      FROM api_keys k
      JOIN users u ON k.user_id = u.id
      WHERE k.is_active = true 
      AND u.is_active = true
      AND (k.expires_at IS NULL OR k.expires_at > NOW())
    `);

    // Check each key (since we can't reverse hash)
    let validKey = null;
    for (const row of result.rows) {
      if (await bcrypt.compare(apiKey, row.key_hash)) {
        validKey = row;
        break;
      }
    }

    if (!validKey) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    // Update last used timestamp
    await authPool.query(
      'UPDATE api_keys SET last_used = NOW() WHERE id = $1',
      [validKey.id]
    );

    req.user = {
      id: validKey.user_id,
      username: validKey.username,
      role: validKey.role,
      email: validKey.email,
      permissions: validKey.permissions
    };

    next();
  } catch (error) {
    console.error('API key verification error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

// Combined auth middleware (JWT or API key)
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const apiKey = req.headers['x-api-key'];

  if (token) {
    return verifyToken(req, res, next);
  } else if (apiKey) {
    return verifyApiKey(req, res, next);
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
};

// Role-based access control middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

// Permission-based access control for API keys
const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Admins have all permissions
    if (req.user.role === 'admin') {
      return next();
    }

    // Check specific permission for API keys
    if (req.user.permissions && req.user.permissions[permission]) {
      return next();
    }

    return res.status(403).json({ error: `Missing permission: ${permission}` });
  };
};

// Login endpoint handler
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const result = await authPool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await authPool.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

// Generate API key endpoint handler
async function generateUserApiKey(req, res) {
  const { name, permissions, expiresIn } = req.body;
  const userId = req.user.id;

  try {
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);
    
    let expiresAt = null;
    if (expiresIn) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresIn));
    }

    await authPool.query(
      `INSERT INTO api_keys (user_id, key_hash, name, permissions, expires_at) 
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, keyHash, name || 'API Key', permissions || {}, expiresAt]
    );

    res.json({
      apiKey,
      message: 'API key generated successfully. Store it securely as it cannot be retrieved again.'
    });
  } catch (error) {
    console.error('API key generation error:', error);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
}

module.exports = {
  authenticate,
  authorize,
  checkPermission,
  verifyToken,
  verifyApiKey,
  login,
  generateUserApiKey,
  authPool
};