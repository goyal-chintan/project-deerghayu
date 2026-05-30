import express from 'express';
import db from '../db.js';

const router = express.Router();

// GET weekly or specific date meal plans
router.get('/', (req, res) => {
  const { start_date, end_date, date } = req.query;
  
  try {
    let plans = [];
    if (date) {
      plans = db.prepare(`SELECT * FROM meal_plans WHERE user_id = ? AND date = ? AND deleted_at IS NULL ORDER BY meal_type`).all(req.user.id, date);
    } else if (start_date && end_date) {
      plans = db.prepare(`SELECT * FROM meal_plans WHERE user_id = ? AND date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date, meal_type`).all(req.user.id, start_date, end_date);
    } else {
      plans = db.prepare(`SELECT * FROM meal_plans WHERE user_id = ? AND deleted_at IS NULL ORDER BY date DESC LIMIT 50`).all(req.user.id);
    }
    
    res.json(plans.map(p => ({
      ...p,
      items: JSON.parse(p.items || '[]')
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new meal plan
router.post('/', (req, res) => {
  const { date, meal_type, items } = req.body;
  if (!date || !meal_type) return res.status(400).json({ error: 'Date and meal_type required' });

  try {
    const stmt = db.prepare(`
      INSERT INTO meal_plans (user_id, date, meal_type, items)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(req.user.id, date, meal_type, JSON.stringify(items || []));
    
    const newPlan = db.prepare('SELECT * FROM meal_plans WHERE id = ?').get(info.lastInsertRowid);
    newPlan.items = JSON.parse(newPlan.items || '[]');
    res.status(201).json(newPlan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update meal plan
router.put('/:id', (req, res) => {
  const { date, meal_type, items } = req.body;
  const id = req.params.id;

  try {
    const stmt = db.prepare(`
      UPDATE meal_plans
      SET date = ?, meal_type = ?, items = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `);
    const info = stmt.run(date, meal_type, JSON.stringify(items || []), id, req.user.id);
    
    if (info.changes === 0) return res.status(404).json({ error: 'Not found' });

    const updated = db.prepare('SELECT * FROM meal_plans WHERE id = ?').get(id);
    updated.items = JSON.parse(updated.items || '[]');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE meal plan
router.delete('/:id', (req, res) => {
  try {
    const info = db.prepare(`UPDATE meal_plans SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
