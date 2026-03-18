const express = require('express');
const { getPool } = require('../config/database');
const { verifyToken } = require('./auth');

const router = express.Router();

router.use(verifyToken);

router.get('/counter', async (req, res) => {
  try {
    const userId = req.user.userId;
    const pool = getPool();
    
    const result = await pool.query(
      'SELECT value FROM counter WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      await pool.query(
        'INSERT INTO counter (user_id, value, updated_at) VALUES ($1, 0, NOW())',
        [userId]
      );
      return res.json({ value: 0 });
    }

    res.json({ value: result.rows[0].value });
  } catch (error) {
    console.error('Get counter error:', error);
    res.status(500).json({ error: 'Failed to get counter value' });
  }
});

router.put('/counter', async (req, res) => {
  try {
    const { value } = req.body;
    const userId = req.user.userId;

    if (typeof value !== 'number') {
      return res.status(400).json({ error: 'Value must be a number' });
    }

    const pool = getPool();
    
    await pool.query(
      `INSERT INTO counter (user_id, value, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (user_id) 
       DO UPDATE SET value = $2, updated_at = NOW()`,
      [userId, value]
    );

    res.json({ value });
  } catch (error) {
    console.error('Update counter error:', error);
    res.status(500).json({ error: 'Failed to update counter value' });
  }
});

module.exports = router;
