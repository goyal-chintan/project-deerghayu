import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDiet } from './seed-native.js';

describe('classifyDiet — Hindi/Urdu non-veg keywords', () => {
  it('murgh → non_veg', () => {
    assert.equal(classifyDiet('Murgh curry'), 'non_veg');
  });
  it('jhinga → non_veg', () => {
    assert.equal(classifyDiet('Jhinga masala'), 'non_veg');
  });
  it('machli → non_veg', () => {
    assert.equal(classifyDiet('Machli fry'), 'non_veg');
  });
  it('boti → non_veg', () => {
    assert.equal(classifyDiet('Boti kebab'), 'non_veg');
  });
  it('seekh → non_veg', () => {
    assert.equal(classifyDiet('Seekh kebab'), 'non_veg');
  });
  it('rogan josh → non_veg', () => {
    assert.equal(classifyDiet('Rogan josh'), 'non_veg');
  });
  it('nihari → non_veg', () => {
    assert.equal(classifyDiet('Nihari'), 'non_veg');
  });
  it('haleem → non_veg', () => {
    assert.equal(classifyDiet('Haleem'), 'non_veg');
  });
  it('paneer butter masala → veg', () => {
    assert.equal(classifyDiet('Paneer butter masala'), 'veg');
  });
  it('aloo gobi → veg', () => {
    assert.equal(classifyDiet('Aloo gobi'), 'veg');
  });
  it('dal tadka → veg', () => {
    assert.equal(classifyDiet('Dal tadka'), 'veg');
  });
  it('biryani → non_veg (default; chicken biryani is canonical)', () => {
    assert.equal(classifyDiet('Biryani'), 'non_veg');
  });
});
