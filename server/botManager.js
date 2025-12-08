const { calculateScore } = require('./utils');

class BotManager {
  constructor(io, hooks = {}) {
    this.io = io;
    this.hooks = hooks;
    this.botState = new Map();
    this.cardTimers = new Map();
    this.actionTimers = new Map();
  }

  handleRoomReset(code) {
    this.clearTimersForRoom(this.cardTimers, code);
    this.clearTimersForRoom(this.actionTimers, code);
    this.clearBotState(code);
  }

  handleNewTurn(room) {
    if (!room || !room.started || room.phase !== 'playCard') return;
    this.handleRoomReset(room.code); // clear lingering timers/state each turn
    const bots = this.getActiveBots(room).filter(bot => !bot.hasDecided);
    bots.forEach(bot => {
      const delay = this.randomDelay(800, 2200);
      const timerId = setTimeout(() => {
        this.cardTimers.delete(this.timerKey(room.code, bot.playerId));
        const decision = this.chooseCard(bot, room);
        if (!decision) return;
        if (typeof this.hooks.playCard === 'function') {
          this.hooks.playCard(room, bot, decision.card, decision.skip, decision.projectedScore);
        }
      }, delay);
      this.cardTimers.set(this.timerKey(room.code, bot.playerId), timerId);
    });
  }

  handleActionPhase(room) {
    if (!room || !room.started || room.phase !== 'action') return;
    const bots = this.getActiveBots(room).filter(bot => bot.playedCard && !bot.action);
    bots.forEach(bot => {
      const delay = this.randomDelay(900, 2000);
      const timerId = setTimeout(() => {
        this.actionTimers.delete(this.timerKey(room.code, bot.playerId));
        const action = this.decideAction(bot, room);
        if (typeof this.hooks.chooseAction === 'function') {
          this.hooks.chooseAction(room, bot, action);
        }
      }, delay);
      this.actionTimers.set(this.timerKey(room.code, bot.playerId), timerId);
    });
  }

  notifyTurnResolution(room) {
    if (!room) return;
    this.clearTimersForRoom(this.cardTimers, room.code);
    this.clearTimersForRoom(this.actionTimers, room.code);
    this.clearBotState(room.code);
  }

  getActiveBots(room) {
    return room.players.filter(p => p.isBot && p.heart > 0 && p.hand.length > 0 && !p.isDead);
  }

  chooseCard(bot, room) {
    if (!bot.hand || bot.hand.length === 0) {
      return { card: null, skip: true, projectedScore: 0 };
    }

    const competition = room.competition || 'vocal';
    const event = room.event || null;
    const evaluations = bot.hand.map(card => {
      const baseScore = this.safeScore(card, competition, event);
      const weight = baseScore + this.skillPreference(card, bot, room) + this.rarityWeight(card.rarity);
      return { card, value: weight, baseScore };
    });

    evaluations.sort((a, b) => b.value - a.value);
    const best = evaluations[0];
    if (!best) {
      return { card: null, skip: true, projectedScore: 0 };
    }

    const runnerUp = evaluations[1];
    let finalPick = best;
    if (runnerUp && best.value - runnerUp.value <= 8 && Math.random() < 0.25) {
      finalPick = runnerUp;
    }

    const stateKey = this.timerKey(room.code, bot.playerId);
    this.botState.set(stateKey, {
      projectedScore: Math.max(0, Math.round(finalPick.baseScore)),
      lastCardId: finalPick.card.id,
      updatedAt: Date.now()
    });

    return { card: finalPick.card, skip: false, projectedScore: finalPick.baseScore };
  }

  decideAction(bot, room) {
    const competition = room.competition || 'vocal';
    const event = room.event || null;
    const state = this.botState.get(this.timerKey(room.code, bot.playerId));
    const projectedScore = state?.projectedScore ?? this.safeScore(bot.playedCard, competition, event);

    if (this.shouldUseSkill(bot, room, projectedScore)) {
      return '2';
    }

    if (this.shouldFlee(bot, room, projectedScore)) {
      return '4';
    }

    if (this.shouldGacha(bot, room, projectedScore)) {
      return '1';
    }

    return '3';
  }

  shouldUseSkill(bot, room, projectedScore) {
    if (!bot.playedCard || !bot.playedCard.skill) return false;
    if (bot.playedCard.skill === 'salt') return false;
    if (bot.actionCooldown > 0) return false;

    const skill = bot.playedCard.skill;
    const lowHeart = bot.heart <= 2;
    const midHeart = bot.heart <= 4;
    const competition = room.competition;
    const hostileEvents = ['shrimp_curse', 'stat_minus_2', 'max_stat_zero'];
    const eventEffect = room.event?.effect;
    const opponents = room.players.filter(p => p !== bot && p.heart > 0 && p.hand.length > 0);

    switch (skill) {
      case 'leek shield':
        return midHeart;
      case 'never give up':
        return bot.heart < 6 && (midHeart || room.turn >= 5);
      case 'divine card':
        return lowHeart || (bot.heart <= 3 && room.turn >= 4);
      case 'gacha god':
        return bot.hand.length <= 3 || projectedScore < 45;
      case 'golden microphone':
        return competition === 'vocal' || projectedScore < 55;
      case 'feet of fire':
        return competition === 'dance' || projectedScore < 55;
      case 'makeup shop visit':
        return competition === 'visual' || projectedScore < 55;
      case 'mic power cut':
      case 'freeze spell':
      case 'banana slip':
        return opponents.length >= 2;
      case 'fate control':
        return hostileEvents.includes(eventEffect);
      case 'hidden skill':
        return opponents.length >= 2 && Math.random() < 0.6;
      default:
        return false;
    }
  }

  shouldGacha(bot, room, projectedScore) {
    if (bot.hand.length <= 2) return true;
    if (projectedScore <= 35 && bot.heart > 2 && room.turn <= 8) return true;
    if (room.event?.effect === 'special_battle' && projectedScore < 60) return true;
    return false;
  }

  shouldFlee(bot, room, projectedScore) {
    if (bot.heart <= 1) return false;
    const activeOpponents = room.players.filter(p => p !== bot && p.heart > 0 && p.hand.length > 0);
    if (activeOpponents.length < 2) return false;
    if (projectedScore < 20 && room.turn >= 4) return true;
    if (room.event?.effect === 'shrimp_curse' && projectedScore < 25) return true;
    return false;
  }

  skillPreference(card, bot, room) {
    if (!card.skill || card.skill === 'salt') return 0;
    const competition = room.competition;
    const lowHeart = bot.heart <= 2;
    switch (card.skill) {
      case 'leek shield':
        return lowHeart ? 35 : 18;
      case 'never give up':
        return bot.heart < 6 ? 25 : 10;
      case 'divine card':
        return lowHeart ? 40 : 12;
      case 'gacha god':
        return bot.hand.length <= 3 ? 22 : 8;
      case 'golden microphone':
        return competition === 'vocal' ? 24 : 10;
      case 'feet of fire':
        return competition === 'dance' ? 24 : 10;
      case 'makeup shop visit':
        return competition === 'visual' ? 24 : 10;
      case 'mic power cut':
      case 'freeze spell':
      case 'banana slip':
        return 12;
      case 'fate control':
        return this.isHostileEvent(room.event) ? 28 : 6;
      case 'hidden skill':
        return 16;
      default:
        return 5;
    }
  }

  isHostileEvent(event) {
    if (!event) return false;
    return ['shrimp_curse', 'stat_minus_2', 'max_stat_zero'].includes(event.effect);
  }

  rarityWeight(rarity = '') {
    switch (rarity.toLowerCase()) {
      case 'fes': return 8;
      case 'limit': return 4;
      default: return 0;
    }
  }

  safeScore(card, competition, event) {
    if (!card) return 0;
    try {
      return calculateScore(card, competition, event) || 0;
    } catch (err) {
      console.error('[BotManager] Failed to calculate score:', err.message);
      return 0;
    }
  }

  timerKey(code, playerId) {
    return `${code}:${playerId}`;
  }

  randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  clearTimersForRoom(map, code) {
    for (const [key, timer] of map.entries()) {
      if (key.startsWith(`${code}:`)) {
        clearTimeout(timer);
        map.delete(key);
      }
    }
  }

  clearBotState(code) {
    for (const key of Array.from(this.botState.keys())) {
      if (key.startsWith(`${code}:`)) {
        this.botState.delete(key);
      }
    }
  }
}

module.exports = BotManager;
