const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const presetService = require('../services/presetService');
const { notifyPresetChanged } = require('../scheduler/phaseScheduler');

// All routes require authentication
router.use(authMiddleware);

// Helper: extract user id from JWT-populated req.user
function userId(req) {
  return req.user?.id;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

router.get('/profile', async (req, res) => {
  try {
    const profile = await presetService.getProfile(userId(req));
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profile', async (req, res) => {
  try {
    const ok = await presetService.updateProfile(userId(req), req.body);
    if (!ok) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Universe preset
// ---------------------------------------------------------------------------

// PUT /api/profile/universe — set the active preset
router.put('/profile/universe', async (req, res) => {
  try {
    const { presetId } = req.body;
    if (!presetId) return res.status(400).json({ error: 'presetId is required' });

    // Verify the preset belongs to this user
    const preset = await presetService.getPresetById(Number(presetId), userId(req));
    if (!preset) return res.status(404).json({ error: 'Preset not found' });

    await presetService.setActivePreset(userId(req), preset.id);
    notifyPresetChanged();
    res.json({ ok: true, activePresetId: preset.id });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Preset CRUD
// ---------------------------------------------------------------------------

router.get('/profile/presets', async (req, res) => {
  try {
    const presets = await presetService.getPresetsForUser(userId(req));
    res.json(presets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/profile/preset', async (req, res) => {
  try {
    const preset = await presetService.createPreset(userId(req), req.body);
    notifyPresetChanged();
    res.status(201).json(preset);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/profile/preset/:id', async (req, res) => {
  try {
    const preset = await presetService.updatePreset(Number(req.params.id), userId(req), req.body);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    notifyPresetChanged();
    res.json(preset);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/profile/preset/:id', async (req, res) => {
  try {
    const deleted = await presetService.deletePreset(Number(req.params.id), userId(req));
    if (!deleted) return res.status(404).json({ error: 'Preset not found' });
    notifyPresetChanged();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

router.get('/profile/watchlist', async (req, res) => {
  try {
    const watchlist = await presetService.getWatchlist(userId(req));
    res.json(watchlist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/profile/watchlist', async (req, res) => {
  try {
    const symbol = await presetService.addToWatchlist(userId(req), req.body.symbol);
    res.status(201).json({ symbol });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/profile/watchlist/:symbol', async (req, res) => {
  try {
    const removed = await presetService.removeFromWatchlist(userId(req), req.params.symbol);
    if (!removed) return res.status(404).json({ error: 'Symbol not in watchlist' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
