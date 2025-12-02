// server/roomManager.js - จัดการห้องและผู้เล่น
const { v4: uuidv4 } = require('uuid');
const { CardDeck, shuffle } = require('./utils');

class RoomManager {
  constructor(events) {
    this.rooms = new Map();
    this.EVENTS = events;
  }

  /**
   * สร้างห้องใหม่
   * @param {string} name - ชื่อผู้เล่นเจ้าของห้อง
   * @returns {object} {code, playerId}
   */
  createRoom(name) {
    const code = uuidv4().slice(0, 6).toUpperCase();
    const playerId = `player_${Date.now()}_${Math.random()}`;
    
    const player = {
      playerId,
      id: null, // จะเซต socket.id ตอนกด ready
      name: name.trim(),
      heart: 6,
      hand: [],
      ready: false,
      skillCooldown: 0,
      actionCooldown: 0,
      playedCard: null,
      action: null,
      hasDecided: false,
      isDead: false
    };

    this.rooms.set(code, {
      code,
      players: [player],
      started: false,
      turn: 0,
      phase: 'lobby',
      event: null,
      competition: null,
      temporaryHeartLoss: {},
      deck: new CardDeck(),
      protectedPlayers: {},
      skillBlockActive: {},
      divineCardActive: {},
      eventPool: shuffle([...this.EVENTS]),
      usedEvents: 0,
      playedCards: {},
      lastTurnActionResults: [],
      playersToDraw: []
    });

    console.log(`[RoomManager] Room ${code} created by ${name} (playerId: ${playerId})`);
    return { code, playerId };
  }

  /**
   * ผู้เล่นเข้าร่วมห้อง
   * @param {string} code - โค้ดห้อง
   * @param {string} name - ชื่อผู้เล่น
   * @param {string} existingPlayerId - playerId (ถ้า rejoin)
   * @returns {object} {room, player, isRejoin, error}
   */
  joinRoom(code, name, existingPlayerId = null) {
    const room = this.rooms.get(code);
    
    if (!room) {
      return { error: 'ไม่พบห้องนี้' };
    }

    if (room.started) {
      return { error: 'เกมเริ่มแล้ว' };
    }

    // ตรวจสอบ rejoin (ผู้เล่นเดิม reconnect)
    let existingPlayer = existingPlayerId 
      ? room.players.find(p => p.playerId === existingPlayerId)
      : null;

    if (existingPlayer) {
      console.log(`[RoomManager] ${name} rejoined room ${code}`);
      return { room, player: existingPlayer, isRejoin: true };
    }

    // ตรวจสอบชื่อซ้ำ
    const duplicateName = room.players.find(p => p.name === name.trim());
    if (duplicateName) {
      return { error: 'มีคนใส่ชื่อนี้ในห้องแล้ว' };
    }

    // ตรวจสอบห้องเต็ม
    if (room.players.length >= 5) {
      return { error: 'ห้องเต็มแล้ว' };
    }

    // สร้างผู้เล่นใหม่
    const newPlayerId = `player_${Date.now()}_${Math.random()}`;
    const newPlayer = {
      playerId: newPlayerId,
      id: null,
      name: name.trim(),
      heart: 6,
      hand: [],
      ready: false,
      skillCooldown: 0,
      actionCooldown: 0,
      playedCard: null,
      action: null,
      hasDecided: false,
      isDead: false
    };

    room.players.push(newPlayer);
    console.log(`[RoomManager] ${name} joined room ${code} (playerId: ${newPlayerId})`);
    return { room, player: newPlayer, isRejoin: false };
  }

  /**
   * ดึงห้อง
   * @param {string} code - โค้ดห้อง
   * @returns {object} ห้อง
   */
  getRoom(code) {
    return this.rooms.get(code);
  }

  /**
   * อัพเดท socket ID ของผู้เล่น
   * @param {string} code - โค้ดห้อง
   * @param {string} playerId - playerId
   * @param {string} socketId - socket ID ใหม่
   */
  updatePlayerSocketId(code, playerId, socketId) {
    const room = this.rooms.get(code);
    if (!room) return false;

    const player = room.players.find(p => p.playerId === playerId);
    if (!player) return false;

    player.id = socketId;
    return true;
  }

  /**
   * ตั้ง ready
   * @param {string} code - โค้ดห้อง
   * @param {string} socketId - socket ID
   */
  toggleReady(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) return null;

    const player = room.players.find(p => p.id === socketId);
    if (!player) return null;

    player.ready = !player.ready;
    return player;
  }

  /**
   * ดึงข้อมูลผู้เล่นทั้งหมดในห้อง
   * @param {string} code - โค้ดห้อง
   * @returns {array} ข้อมูลผู้เล่น
   */
  getPlayersInfo(code) {
    const room = this.rooms.get(code);
    if (!room) return [];

    return room.players.map(p => ({
      id: p.id,
      name: p.name,
      heart: p.heart,
      handCount: p.hand.length,
      skillCooldown: p.skillCooldown,
      ready: p.ready
    }));
  }

  /**
   * ลบห้อง
   * @param {string} code - โค้ดห้อง
   */
  deleteRoom(code) {
    this.rooms.delete(code);
    console.log(`[RoomManager] Room ${code} deleted`);
  }

  /**
   * ลบผู้เล่นออกจากห้อง
   * @param {string} socketId - socket ID
   * @returns {object} {code, room, removedPlayer}
   */
  removePlayer(socketId) {
    for (const [code, room] of this.rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === socketId);
      if (playerIndex !== -1) {
        const removedPlayer = room.players[playerIndex];
        room.players.splice(playerIndex, 1);

        console.log(`[RoomManager] ${removedPlayer.name} removed from room ${code}`);

        // ลบห้องถ้าว่างเปล่า
        if (room.players.length === 0) {
          this.deleteRoom(code);
          return { code, room: null, removedPlayer };
        }

        return { code, room, removedPlayer };
      }
    }
    return { code: null, room: null, removedPlayer: null };
  }

  /**
   * ตรวจสอบว่าทุกคน ready ไหม
   * @param {string} code - โค้ดห้อง
   * @returns {boolean}
   */
  isAllReady(code) {
    const room = this.rooms.get(code);
    if (!room || room.players.length < 2) return false;
    return room.players.every(p => p.ready);
  }

  /**
   * รีเซ็ตห้องสำหรับเกมใหม่
   * @param {string} code - โค้ดห้อง
   */
  resetRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;

    console.log(`[RoomManager] Resetting room ${code}`);
    
    room.started = false;
    room.phase = 'lobby';
    room.turn = 0;
    room.event = null;
    room.competition = null;
    room.temporaryHeartLoss = {};
    room.protectedPlayers = {};
    room.skillBlockActive = {};
    room.divineCardActive = {};
    room.eventPool = shuffle([...this.EVENTS]);
    room.usedEvents = 0;
    room.playedCards = {};
    room.lastTurnActionResults = [];
    room.playersToDraw = [];

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
    });

    room.deck = new CardDeck();
  }

  /**
   * ตรวจสอบคนที่ยังเล่นได้
   * @param {string} code - โค้ดห้อง
   * @returns {array} ผู้เล่นที่ยังเล่นได้
   */
  getAlivePlayers(code) {
    const room = this.rooms.get(code);
    if (!room) return [];
    return room.players.filter(p => p.heart > 0 && p.hand.length > 0);
  }
}

module.exports = RoomManager;