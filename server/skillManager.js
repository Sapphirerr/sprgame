// server/skillManager.js - Skill effect handler system for all 13 skills

/**
 * Skill Effect Specifications:
 * 1. salt - No effect
 * 2. leek shield - No lose Willpower this turn
 * 3. never give_up - Restore 2 Willpower
 * 4. golden microphone - +5 Vocal
 * 5. feet of fire - +5 Dance
 * 6. makeup shop visit - +5 Visual
 * 7. mic power cut - All other players: -5 Vocal
 * 8. freeze spell - All other players: -5 Dance
 * 9. banana slip - All other players: -5 Visual
 * 10. fate control - Randomly change this turn's competition type
 * 11. hidden skill - Other players' skills have no effect
 * 12. gacha god - Draw 2 random cards
 * 13. divine card - If Willpower = 0 at start of next turn, revive +1 Willpower and draw 10 cards
 */

class SkillManager {
  /**
   * Process skill activation for a player
   * @param {Object} skill - Card's skill name
   * @param {Object} player - Player object
   * @param {Object} card - Card object being played
   * @param {Array} allPlayers - Array of all players in room
   * @param {Object} gameState - Game state object (room reference)
   * @param {Object} io - Socket.io instance for emitting events
   * @param {Function} getNextEvent - Function to get next event
   * @returns {Object} Result object with effects applied
   */
  static activateSkill(skill, player, card, allPlayers, gameState, io = null, getNextEvent = null) {
    const result = {
      skillName: skill,
      playerName: player.name,
      effects: [],
      statModifiers: {} // Track which players get stat bonuses/penalties
    };

    switch (skill) {
      case 'salt':
        result.effects.push('No effect');
        break;

      case 'leek shield':
        // Mark player to prevent heart loss this turn
        result.effects.push('Protected from willpower loss this turn');
        // Store in temporary protection map
        gameState.protectedPlayers = gameState.protectedPlayers || {};
        gameState.protectedPlayers[player.id] = true;
        break;

      case 'never give up':
        // Restore 2 willpower
        const oldHeart = player.heart;
        player.heart = Math.min(6, player.heart + 2);
        const restored = player.heart - oldHeart;
        result.effects.push(`Restored ${restored} willpower (${oldHeart} → ${player.heart})`);
        break;

      case 'golden microphone':
        // +5 Vocal to player's card
        result.statModifiers[player.id] = { vocal: 5 };
        result.effects.push('+5 Vocal bonus applied');
        break;

      case 'feet of fire':
        // +5 Dance to player's card
        result.statModifiers[player.id] = { dance: 5 };
        result.effects.push('+5 Dance bonus applied');
        break;

      case 'makeup shop visit':
        // +5 Visual to player's card
        result.statModifiers[player.id] = { visual: 5 };
        result.effects.push('+5 Visual bonus applied');
        break;

      case 'mic power cut':
        // -5 Vocal to all OTHER players
        allPlayers.forEach(p => {
          if (p.id !== player.id && p.playedCard) {
            result.statModifiers[p.id] = { vocal: -5 };
            result.effects.push(`-5 Vocal debuff to ${p.name}`);
          }
        });
        break;

      case 'freeze spell':
        // -5 Dance to all OTHER players
        allPlayers.forEach(p => {
          if (p.id !== player.id && p.playedCard) {
            result.statModifiers[p.id] = { dance: -5 };
            result.effects.push(`-5 Dance debuff to ${p.name}`);
          }
        });
        break;

      case 'banana slip':
        // -5 Visual to all OTHER players
        allPlayers.forEach(p => {
          if (p.id !== player.id && p.playedCard) {
            result.statModifiers[p.id] = { visual: -5 };
            result.effects.push(`-5 Visual debuff to ${p.name}`);
          }
        });
        break;

      case 'fate control':
        // ✅ Re-roll the event (ไม่รวมอีเวนต์พิเศษ)
        const currentEvent = gameState.event ? gameState.event.name : 'Unknown';
        const specialEffects = ['reveal_cards', 'special_battle', 'draw_3']; // อีเวนต์พิเศษที่ไม่เปลี่ยน
        
        // ถ้าเป็นอีเวนต์พิเศษ ไม่เปลี่ยน
        if (gameState.event && specialEffects.includes(gameState.event.effect)) {
          result.effects.push(`Cannot change special event: ${currentEvent}`);
        } else if (getNextEvent) {
          // สุ่มอีเวนต์ใหม่
          const oldEvent = gameState.event;
          gameState.event = getNextEvent(gameState);
          result.effects.push(`Changed event from ${currentEvent} to ${gameState.event.name}`);
          
          // ส่งสลอตอีเวนต์ใหม่ไปให้ client
          if (io && gameState.code) {
            io.to(gameState.code).emit('fateControlEventChange', {
              oldEvent: oldEvent,
              newEvent: gameState.event,
              player: player.name
            });
          }
        } else {
          result.effects.push('Fate Control failed: No event system available');
        }
        break;

      case 'hidden skill':
        // Block opponent skills this turn
        gameState.skillBlockActive = gameState.skillBlockActive || {};
        gameState.skillBlockActive[player.id] = true;
        result.effects.push('Other players\' skills blocked this turn');
        break;

      case 'gacha god':
        // Draw 2 random cards (Gacha God skill)
        // Note: This is handled in the calling function (index.js)
        result.effects.push('Drew 2 random cards (Gacha God)');
        break;

      case 'divine card':
        // Special mechanic: handled in nextTurn check
        // Mark this player as having divine card active
        gameState.divineCardActive = gameState.divineCardActive || {};
        gameState.divineCardActive[player.id] = true;
        result.effects.push('Divine Card: Ready to revive on next turn if heart reaches 0');
        break;

      default:
        result.effects.push(`Unknown skill: ${skill}`);
    }

    return result;
  }

  /**
   * ⚠️ DEPRECATED - Stat modifiers are now applied directly to card stats in index.js
   * before calling calculateScore() for accurate recalculation
   */
  static applyStatModifiers(baseScore, playerId, modifiers) {
    // This method is kept for backward compatibility but should not be used
    console.warn('[DEPRECATED] applyStatModifiers called - use direct stat modification instead');
    return baseScore;
  }

  /**
   * Check if hidden_skill is blocking this player's skill
   * @param {Object} gameState - Game state
   * @param {string} playerId - Player attempting to use skill
   * @returns {boolean} True if skill is blocked
   */
  static isSkillBlocked(gameState, playerId) {
    if (!gameState.skillBlockActive) return false;
    
    // If the player using hidden skill is blocking, their own skills work
    for (const blockerId in gameState.skillBlockActive) {
      if (blockerId !== playerId && gameState.skillBlockActive[blockerId]) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check Divine Card revival condition at start of turn
   * @param {Object} player - Player to check
   * @param {Object} gameState - Game state
   * @param {Function} drawCards - Card drawing function
   * @returns {Object} Revival result
   */
  static checkDivineCardRevival(player, gameState, deck) {
    const result = {
      revived: false,
      drewCards: 0,
      cards: [],
      expired: false
    };

    const hasPendingDivine = gameState.divineCardActive && gameState.divineCardActive[player.id];
    if (!hasPendingDivine) {
      return result;
    }

    // Consume the flag regardless of outcome (effect lasts 1 turn)
    delete gameState.divineCardActive[player.id];

    if (player.heart === 0) {
      player.heart = 1;
      if (deck && typeof deck.drawCards === 'function') {
        const cards = deck.drawCards(10);
        player.hand.push(...cards);
        result.drewCards = cards.length;
        result.cards = cards;
      }
      result.revived = true;
      console.log(`✨ ${player.name} revived by Divine Card! Heart: 0 → 1, Drew ${result.drewCards} cards`);
    } else {
      result.expired = true;
      console.log(`⚠️ ${player.name}'s Divine Card expired (heart = ${player.heart})`);
    }

    return result;
  }

  /**
   * Clear temporary skill effects at end of turn
   * @param {Object} gameState - Game state to clear
   */
  static clearTemporaryEffects(gameState) {
    gameState.protectedPlayers = {};
    gameState.skillBlockActive = {};
    gameState.divineCardActive = gameState.divineCardActive || {}; // Keep for next turn check
  }
}

module.exports = SkillManager;
