import express from 'express';
import db from '../db.js';

const router = express.Router();

// Helper to calculate targets based on age, gender, weight, height, activity, and goals
function calculateTargets(member) {
  let { age, gender, weight_kg, height_cm, activity_level, goal_type } = member;
  age = Number(age) || 30;
  weight_kg = Number(weight_kg) || 60;
  height_cm = Number(height_cm) || 165;
  goal_type = goal_type || 'maintain';
  
  let bmr = 0;
  if (age < 2) {
    // Infants & toddlers: simple heuristic (roughly 80-100 kcal / kg)
    bmr = weight_kg * 90;
  } else {
    // Mifflin-St Jeor
    if (gender === 'male' || gender === 'm') {
      bmr = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) + 5;
    } else {
      bmr = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) - 161;
    }
  }

  // TDEE multiplier
  const multipliers = {
    'sedentary': 1.2,
    'light': 1.375,
    'moderate': 1.55,
    'active': 1.725,
    'very_active': 1.9
  };
  const multiplier = multipliers[activity_level] || 1.2;
  let calories = Math.round(bmr * multiplier);

  // Apply goal adjustments to calories
  if (goal_type === 'lose_weight') {
    calories = Math.max(gender === 'male' || gender === 'm' ? 1500 : 1200, calories - 500);
  } else if (goal_type === 'gain_muscle') {
    calories += 350;
  } else if (goal_type === 'pregnancy') {
    calories += 350;
  } else if (goal_type === 'lactation') {
    calories += 500;
  }

  // Proteins
  let proteins = 0;
  if (goal_type === 'lose_weight') {
    proteins = Math.round(weight_kg * 1.4); // Higher protein to preserve lean muscle during deficit
  } else if (goal_type === 'gain_muscle') {
    proteins = Math.round(weight_kg * 1.8); // High protein for building muscle
  } else if (goal_type === 'pregnancy') {
    proteins = Math.round(weight_kg * 1.1) + 25; // standard pregnancy RDA increase
  } else if (goal_type === 'lactation') {
    proteins = Math.round(weight_kg * 1.1) + 19; // lactation RDA increase
  } else {
    proteins = Math.round(weight_kg * (age < 2 ? 1.2 : 0.8)); // Standard RDA
  }

  // Fat (20-35% of total calories)
  let fatPercent = 0.25;
  if (goal_type === 'lose_weight') {
    fatPercent = 0.22;
  } else if (goal_type === 'gain_muscle') {
    fatPercent = 0.25;
  }
  let fat = Math.round((calories * fatPercent) / 9);

  // Carbohydrates (remainder of calories)
  let carbohydrates = Math.round((calories - (proteins * 4) - (fat * 9)) / 4);
  if (carbohydrates < 50) carbohydrates = 50; // Safety floor

  // Micronutrients base values (scientific RDA levels)
  let calcium = 1000;
  let iron = 8;
  let vitamin_a = 900;
  let vitamin_c = 90;
  let vitamin_d = 15;

  if (age < 2) {
    calcium = 500;
    iron = 7;
    vitamin_a = 400;
    vitamin_c = 40;
    vitamin_d = 10;
  } else if (age >= 2 && age <= 8) {
    calcium = 800;
    iron = 10;
    vitamin_a = 400;
    vitamin_c = 45;
    vitamin_d = 15;
  } else if (age >= 9 && age <= 13) {
    calcium = 1300;
    iron = 8;
    vitamin_a = 600;
    vitamin_c = 45;
    vitamin_d = 15;
  } else if (age >= 14 && age <= 18) {
    calcium = 1300;
    iron = (gender === 'female' || gender === 'f') ? 15 : 11;
    vitamin_a = (gender === 'female' || gender === 'f') ? 700 : 900;
    vitamin_c = (gender === 'female' || gender === 'f') ? 65 : 75;
    vitamin_d = 15;
  } else {
    // Adults >= 19
    calcium = 1000;
    iron = (gender === 'female' || gender === 'f') ? 18 : 8;
    vitamin_a = (gender === 'female' || gender === 'f') ? 700 : 900;
    vitamin_c = (gender === 'female' || gender === 'f') ? 75 : 90;
    vitamin_d = 15;
  }

  // Life Stage Adjustments
  if (goal_type === 'pregnancy') {
    calcium = 1200;
    iron = 27; // High iron requirement
    vitamin_a = 770;
    vitamin_c = 85;
    vitamin_d = 15;
  } else if (goal_type === 'lactation') {
    calcium = 1200;
    iron = 9;
    vitamin_a = 1300; // Significantly higher Vitamin A
    vitamin_c = 120;
    vitamin_d = 15;
  }

  return {
    calories,
    proteins,
    carbohydrates,
    fat,
    calcium,
    iron,
    'vitamin-a': vitamin_a,
    'vitamin-c': vitamin_c,
    'vitamin-d': vitamin_d
  };
}

// GET all family members for user
router.get('/', (req, res) => {
  try {
    const members = db.prepare(`SELECT * FROM family_members WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`).all(req.user.id);
    res.json(members.map(m => ({
      ...m,
      targets: JSON.parse(m.targets || '{}')
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new family member
router.post('/', (req, res) => {
  const { name, age, gender, weight_kg, height_cm, activity_level, custom_targets, goal_type } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  let targets = calculateTargets({ age, gender, weight_kg, height_cm, activity_level, goal_type });
  if (custom_targets) {
    Object.keys(custom_targets).forEach(k => {
      const val = Number(custom_targets[k]);
      if (!isNaN(val) && val > 0) {
        targets[k] = Math.round(val);
      }
    });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO family_members (user_id, name, age, gender, weight_kg, height_cm, activity_level, goal_type, targets)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      req.user.id, name, age, gender, weight_kg, height_cm, activity_level, goal_type || 'maintain', JSON.stringify(targets)
    );
    
    const newMember = db.prepare('SELECT * FROM family_members WHERE id = ?').get(info.lastInsertRowid);
    newMember.targets = JSON.parse(newMember.targets || '{}');
    res.status(201).json(newMember);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update family member
router.put('/:id', (req, res) => {
  const { name, age, gender, weight_kg, height_cm, activity_level, custom_targets, goal_type } = req.body;
  const id = req.params.id;

  let targets = calculateTargets({ age, gender, weight_kg, height_cm, activity_level, goal_type });
  if (custom_targets) {
    Object.keys(custom_targets).forEach(k => {
      const val = Number(custom_targets[k]);
      if (!isNaN(val) && val > 0) {
        targets[k] = Math.round(val);
      }
    });
  }

  try {
    const stmt = db.prepare(`
      UPDATE family_members
      SET name = ?, age = ?, gender = ?, weight_kg = ?, height_cm = ?, activity_level = ?, goal_type = ?, targets = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `);
    const info = stmt.run(
      name, age, gender, weight_kg, height_cm, activity_level, goal_type || 'maintain', JSON.stringify(targets), id, req.user.id
    );
    
    if (info.changes === 0) return res.status(404).json({ error: 'Not found' });

    const updated = db.prepare('SELECT * FROM family_members WHERE id = ?').get(id);
    updated.targets = JSON.parse(updated.targets || '{}');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE family member
router.delete('/:id', (req, res) => {
  try {
    const info = db.prepare(`UPDATE family_members SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
