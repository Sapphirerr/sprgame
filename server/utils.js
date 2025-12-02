// server/utils.js
const fs = require('fs');
const path = require('path');

let CARDS = [];
let EVENTS = [];

try {
  CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cards.json'), 'utf8'));
  EVENTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'events.json'), 'utf8'));
} catch (err) {
  console.error('โหลด cards.json หรือ events.json ไม่ได้!', err);
}

const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

// ==================== EVENT EFFECTS ====================
// Convert event object to event effects for score calculation
const getEventModifiers = (event, card) => {
  if (!event || event.effect === 'none') return {};
  
  const modifiers = {};
  
  // Stat penalties - ลบค่าพลังทุกอย่างลงอย่างละ 2 หน่วย
  if (event.effect === 'stat_minus_2') {
    return { statMinus: 2 };
  }
  
  // Type-based buffs - Type love/hope/happy เพิ่มคะแนนตามที่กำหนดใน event
  if (event.effect === 'type_buff') {
    if (card.type === event.type) {
      modifiers.typeBonus = event.scoreBonus || 5;
    }
  }
  
  // Rarity buffs - Limit/Fes เพิ่มคะแนนตามที่กำหนดใน event
  if (event.effect === 'rarity_buff') {
    if (event.rarity && event.rarity.includes(card.rarity)) {
      modifiers.rarityBonus = event.scoreBonus || 10;
    }
  }
  
  // Group buffs - สมาชิก VS/LN/MMJ/VBS/WxS/Niko เพิ่มคะแนนตามที่กำหนดใน event
  if (event.effect === 'group_buff') {
    if (card.group === event.group) {
      modifiers.groupBonus = event.scoreBonus || 5;
    }
  }

  // SapphireR: Kohane เพิ่มคะแนนตามที่กำหนดใน event
  if (event.effect === 'sapphire_r') {
    if ((card.characterBase || card.character) === 'Kohane') {
      modifiers.characterBonus = event.scoreBonus || 30;
    }
  }
  
  // max_stat_zero - ค่าพลังที่เยอะที่สุดของการ์ดนั้น จะถูกลบไป (ค่า 0)
  if (event.effect === 'max_stat_zero') {
    modifiers.maxStatZero = true;
  }
  
  // draw_3 - ผู้เล่นสุ่มกาชาคนละ 3 ใบ (handled in resolveTurn)
  if (event.effect === 'draw_3') {
    modifiers.drawCards = 3;
  }
  
  // heal_1 - ผู้เล่นฟื้นฟูพลังใจ 1 หน่วย (handled in resolveTurn)
  if (event.effect === 'heal_1') {
    modifiers.healWillpower = 1;
  }
  
  // special_battle - ไม่สุ่มการแข่งขัน แข่งรูปแบบพิเศษ ค่าพลังที่+กัน ไม่มีตัวคูณ
  if (event.effect === 'special_battle') {
    modifiers.specialBattle = true;
  }
  
  // reveal_cards - หงายการ์ดในเทิร์นนั้น (handled in resolveTurn/emit)
  if (event.effect === 'reveal_cards') {
    modifiers.revealCards = true;
  }
  
  // shrimp_curse - ค่าพลังใจของผู้เล่น -1 หากจบเทิร์น ได้คืน แต่ถ้าหากพลังใจตกรอบทันที
  if (event.effect === 'shrimp_curse') {
    modifiers.shrimpCurse = true;
  }
  
  return modifiers;
};

// คำนวณค่าพลังตามประเภทการแข่งขัน (รับ event object ด้วย)
const calculateScore = (card, type, event) => {
  if (!card) return 0;
  let v = card.vocal || 0;
  let d = card.dance || 0;
  let vi = card.visual || 0;
  
  // Apply event modifiers
  const modifiers = getEventModifiers(event, card);
  
  // Apply stat penalties first
  if (modifiers.statMinus) {
    v = Math.max(1, v - modifiers.statMinus);
    d = Math.max(1, d - modifiers.statMinus);
    vi = Math.max(1, vi - modifiers.statMinus);
  }
  
  // max_stat_zero - ค่าพลังที่เยอะที่สุด = 0
  if (modifiers.maxStatZero) {
    const maxStat = Math.max(v, d, vi);
    if (v === maxStat) v = 0;
    if (d === maxStat) d = 0;
    if (vi === maxStat) vi = 0;
  }
  
  let baseScore = 0;
  
  // special_battle - ไม่มีตัวคูณ แค่บวกค่า 3 ตัว
  if (modifiers.specialBattle) {
    baseScore = v + d + vi;
    console.log(`  ✨ [SCORE] special_battle: ${v} + ${d} + ${vi} = ${baseScore}`);
  } else {
    // Normal score calculation with multipliers
    if (type === 'vocal') {
      baseScore = Math.round((v * 2 + d * 1.5 + vi * 1) * 10) / 10; // Keep 1 decimal place
      console.log(`  🎤 [SCORE] Vocal Battle: (${v}*2) + (${d}*1.5) + (${vi}*1) = ${baseScore}`);
    } else if (type === 'dance') {
      baseScore = Math.round((d * 2 + vi * 1.5 + v * 1) * 10) / 10;
      console.log(`  💃 [SCORE] Dance Battle: (${d}*2) + (${vi}*1.5) + (${v}*1) = ${baseScore}`);
    } else if (type === 'visual') {
      baseScore = Math.round((vi * 2 + v * 1.5 + d * 1) * 10) / 10;
      console.log(`  ✨ [SCORE] Visual Battle: (${vi}*2) + (${v}*1.5) + (${d}*1) = ${baseScore}`);
    }
  }
  
  // ==================== Apply Score Bonuses (after calculation) ====================
  let scoreBonus = 0;
  
  // Type buffs: +5 คะแนน
  if (modifiers.typeBonus) {
    scoreBonus += modifiers.typeBonus;
  }
  
  // Rarity buffs: +10 คะแนน
  if (modifiers.rarityBonus) {
    scoreBonus += modifiers.rarityBonus;
  }
  
  // Group buffs: +5 คะแนน
  if (modifiers.groupBonus) {
    scoreBonus += modifiers.groupBonus;
  }
  
  // Character bonus (SapphireR for Kohane): +30 คะแนน
  if (modifiers.characterBonus) {
    scoreBonus += modifiers.characterBonus;
  }
  
  if (scoreBonus > 0) {
    console.log(`  💰 [BONUS] event modifiers: +${scoreBonus} (type:${modifiers.typeBonus || 0}, rarity:${modifiers.rarityBonus || 0}, group:${modifiers.groupBonus || 0}, character:${modifiers.characterBonus || 0})`);
  }
  
  return baseScore + scoreBonus;
};

// ==================== DECK MANAGEMENT ====================
// สร้างกองการ์ดใหม่ (เก็บ ID ที่ใช้ไป เพื่อ recycle)
class CardDeck {
  constructor() {
    this.availableCards = shuffle([...CARDS]); // ✅ สับการ์ดเมื่อสร้าง deck ใหม่
    this.usedCards = [];
  }

  /**
   * ดึงการ์ดจากกองที่ยังไม่ใช้ (1 ใบต่อ ID)
   * ถ้าการ์ดหมดแล้ว ให้ recycle การ์ดที่ใช้ไปแล้ว
   */
  drawCard() {
    // ถ้ากองไม่มีการ์ด → recycle
    if (this.availableCards.length === 0) {
      console.log('♻️  Recycling used cards back to deck');
      this.availableCards = this.usedCards;
      this.usedCards = [];
      this.shuffle();
    }

    // ดึงการ์ด 1 ใบจากกอง
    return this.availableCards.pop();
  }

  /**
   * ดึงการ์ด n ใบ
   */
  drawCards(n = 1) {
    const cards = [];
    for (let i = 0; i < n; i++) {
      cards.push(this.drawCard());
    }
    return cards;
  }

  /**
   * ส่งการ์ดกลับเข้ากอง (หลังใช้ไป)
   */
  returnCard(card) {
    this.usedCards.push(card);
  }

  /**
   * ส่งการ์ดหลายใบกลับเข้ากอง
   */
  returnCards(cards) {
    cards.forEach(card => this.returnCard(card));
  }

  /**
   * สับการ์ดในกอง
   */
  shuffle() {
    this.availableCards = shuffle(this.availableCards);
  }

  /**
   * ดูจำนวนการ์ดที่เหลือ
   */
  deckCount() {
    return {
      available: this.availableCards.length,
      used: this.usedCards.length,
      total: this.availableCards.length + this.usedCards.length
    };
  }
}

// สุ่มการ์ดจากกองปกติ (ใช้ CardDeck แทน)
const drawCards = (n = 1) => {
  const deck = new CardDeck();
  return deck.drawCards(n);
};

// ✅ สุ่มการ์ด 2 ใบสำหรับเทพกาชา (ให้ deck เป็น parameter)
const drawGodGacha = (deck = null) => {
  if (!deck) {
    deck = new CardDeck();
  }
  return deck.drawCards(2);
};

// สุ่มการ์ด 10 ใบสำหรับ revive gacha (ใบเทพ)
const drawReviveGacha = () => {
  const deck = new CardDeck();
  return deck.drawCards(10);
};

// สุ่มอีเวนต์แบบสุ่ม
const getRandomEvent = () => EVENTS[Math.floor(Math.random() * EVENTS.length)];

// สุ่มอีเวนต์ตามลำดับเทิร์น (ซ้ำทุก 19 เทิร์น)
const getEventByTurn = (turn) => {
  const eventIndex = (turn - 1) % EVENTS.length;
  return EVENTS[eventIndex];
};

// สุ่มการแข่งขัน
const getRandomCompetition = () => {
  const types = ['vocal', 'dance', 'visual'];
  return types[Math.floor(Math.random() * types.length)];
};

// ใช้ได้ Action 1: สุ่มกาชาเนิร์ฟ 1 ใบ
// ใช้ได้ Action 2: ใช้สกิล (ติด cooldown 2 เทิร์น) - Gacha God: 2 ใบ, Divine Card: 10 ใบ
// ใช้ได้ Action 3: แข่งตรง ๆ
// ใช้ได้ Action 4: ถอยหนี (ไม่เสียการ์ด แต่เสียพลังใจ)

module.exports = {
  CardDeck,
  drawCards,
  drawGodGacha,
  drawReviveGacha,
  getRandomEvent,
  getEventByTurn,
  getRandomCompetition,
  getEventModifiers,
  calculateScore,
  shuffle
};