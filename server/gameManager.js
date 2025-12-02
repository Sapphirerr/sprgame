// server/gameManager.js - จัดการ game state: turn, event, competition, phase
const { getRandomCompetition, shuffle } = require('./utils');

class GameStateManager {
  /**
   * เริ่มเกม - สร้าง initial state
   * @param {object} room - room object
   */
  static startGame(room) {
    console.log(`[GameStateManager] Starting game in room ${room.code}`);

    room.started = true;
    room.phase = 'drawCards';
    room.turn = 1;
    room.event = null;
    room.competition = null;
    room.playedCards = {};
    room.lastTurnActionResults = [];
    room.playersToDraw = [];
    room.usedEvents = 0;

    // รีเซ็ตสถานะผู้เล่น
    room.players.forEach(p => {
      p.hand = [];
      p.heart = 6;
      p.ready = false;
      p.playedCard = null;
      p.action = null;
      p.skillCooldown = 0;
      p.actionCooldown = 0;
      p.hasDecided = false;
      p.isDead = false;
      p.hasChosenAction = false;
      p.totalScore = 0;
      p.needsGachaGod = false;
    });

    // จั่วการ์ดเริ่มต้น 5 ใบให้ทุกคน
    room.players.forEach(p => {
      p.hand = room.deck.drawCards(5);
      console.log(`📝 ${p.name} starting hand: [${p.hand.map(c => c.id).join(',')}]`);
    });
  }

  /**
   * สุ่มอีเวนต์ถัดไป (cycling 19 events)
   * @param {object} room - room object
   * @returns {object} event
   */
  static getNextEvent(room) {
    if (room.usedEvents >= room.eventPool.length) {
      console.log(`♻️  Event pool exhausted (${room.usedEvents}/${room.eventPool.length}), resetting...`);
      room.eventPool = shuffle([...room.eventPool]);
      room.usedEvents = 0;
    }

    const event = room.eventPool[room.usedEvents];
    room.usedEvents++;
    console.log(`🎲 Event: ${event.name} (${room.usedEvents}/${room.eventPool.length})`);
    return event;
  }

  /**
   * เตรียมเฟส: สุ่มอีเวนต์และการแข่ง
   * @param {object} room - room object
   */
  static prepareEventAndCompetition(room) {
    room.phase = 'eventSlot';
    room.event = this.getNextEvent(room);
    room.competition = getRandomCompetition();
    
    console.log(`📍 Turn ${room.turn}: Event=${room.event.name}, Competition=${room.competition}`);
  }

  /**
   * อัพเดท phase
   * @param {object} room - room object
   * @param {string} newPhase - phase ใหม่
   */
  static setPhase(room, newPhase) {
    const validPhases = [
      'lobby', 'drawCards', 'eventSlot', 'competitionSlot', 
      'mikudayoDraw', 'playCard', 'action', 'resolve'
    ];

    if (!validPhases.includes(newPhase)) {
      throw new Error(`Invalid phase: ${newPhase}`);
    }

    console.log(`[Phase] ${room.phase} → ${newPhase}`);
    room.phase = newPhase;
  }

  /**
   * รีเซ็ต state ผู้เล่นสำหรับเทิร์นใหม่
   * @param {object} room - room object
   */
  static resetPlayerStatesForNewTurn(room) {
    room.players.forEach(p => {
      p.playedCard = null;
      p.action = null;
      p.hasDecided = false;

      // ลดคูลดาวน์ action
      if (p.actionCooldown > 0) {
        p.actionCooldown--;
        console.log(`🔄 ${p.name} CD: ${p.actionCooldown + 1} → ${p.actionCooldown}`);
      }
    });
  }

  /**
   * auto-skip ผู้เล่นที่ตายแล้ว
   * @param {object} room - room object
   */
  static autoSkipDeadPlayers(room) {
    room.players.forEach(p => {
      if (p.heart === 0 || p.hand.length === 0) {
        p.playedCard = null;
        p.hasDecided = true;
        p.action = null;
        p.hasChosenAction = true;
        console.log(`⚰️  ${p.name} auto-skipped (eliminated)`);
      }
    });
  }

  /**
   * ตรวจสอบว่าเกมจบหรือไม่
   * @param {object} room - room object
   * @returns {object} {gameOver: bool, winner: obj or null, isDraw: bool, drawPlayers: array}
   */
  static checkGameOver(room) {
    const alivePlayers = room.players.filter(p => p.heart > 0 && p.hand.length > 0);

    if (alivePlayers.length === 1) {
      return {
        gameOver: true,
        winner: alivePlayers[0],
        isDraw: false,
        drawPlayers: []
      };
    }

    if (alivePlayers.length === 0) {
      return {
        gameOver: true,
        winner: null,
        isDraw: true,
        drawPlayers: room.players.map(p => p.name)
      };
    }

    return {
      gameOver: false,
      winner: null,
      isDraw: false,
      drawPlayers: []
    };
  }

  /**
   * เตรียมเทิร์นใหม่
   * @param {object} room - room object
   */
  static prepareNewTurn(room) {
    room.turn++;
    room.playersToDraw = [];
    room.lastTurnActionResults = [];
    this.resetPlayerStatesForNewTurn(room);
    this.autoSkipDeadPlayers(room);
  }
}

module.exports = GameStateManager;