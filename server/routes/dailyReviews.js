const express = require('express');
const tradeModel = require('../services/trades/tradeModel');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use('/api/reviews', requireAuth);

// Calendar data for month view
router.get('/api/reviews/calendar', async (req, res) => {
  try {
    const { scope = 'user', month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month parameter required (YYYY-MM)' });
    }
    const data = await tradeModel.getCalendarData(req.user.id, scope, month);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List reviews
router.get('/api/reviews', async (req, res) => {
  try {
    const { scope = 'user', from, to } = req.query;
    const reviews = await tradeModel.getDailyReviews(req.user.id, scope, { from, to });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single day review
router.get('/api/reviews/:date', async (req, res) => {
  try {
    const { scope = 'user' } = req.query;
    const review = await tradeModel.getDailyReview(req.user.id, scope, req.params.date);
    res.json(review || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create/update review
router.put('/api/reviews/:date', async (req, res) => {
  try {
    const { scope = 'user' } = req.query;
    const { summaryText, lessonsText, planTomorrow, mood, rating } = req.body || {};
    const review = await tradeModel.upsertDailyReview({
      userId: req.user.id,
      datasetScope: scope,
      reviewDate: req.params.date,
      summaryText,
      lessonsText,
      planTomorrow,
      mood: mood != null ? +mood : null,
      rating: rating != null ? +rating : null,
    });
    res.json(review);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
