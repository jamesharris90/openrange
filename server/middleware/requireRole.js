const db = require('../db');

module.exports = function requireRole(role) {
  return async function (req, res, next) {
    try {
      const userId = req.user.id;
      const queryClient = req.db || db;

      let rows = [];
      try {
        const result = await queryClient.query(
          'SELECT role FROM profiles WHERE id = $1',
          [userId]
        );
        rows = result.rows || [];
      } catch (_error) {
        const fallback = await queryClient.query(
          'SELECT role, is_admin FROM users WHERE id = $1',
          [userId]
        );
        rows = (fallback.rows || []).map((row) => ({
          role: row.role || ((row.is_admin === 1 || row.is_admin === true || row.is_admin === '1') ? 'admin' : 'user'),
        }));
      }

      if (!rows.length) {
        return res.status(403).json({ error: 'User profile not found' });
      }

      const userRole = rows[0].role;

      if (userRole !== role) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    } catch (err) {
      console.error('Role guard error:', err);
      res.status(500).json({ error: 'Role validation failed' });
    }
  };
};
