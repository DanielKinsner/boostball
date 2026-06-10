// Match state machine: countdown → play → (goal → goalPause → countdown) → ... → over.
// Overtime: golden goal — clock counts UP from 0; the next goal ends the match.

import {
  MATCH_LENGTH,
  KICKOFF_COUNTDOWN,
  GOAL_PAUSE_TIME,
  TEAM_BLUE,
  TEAM_ORANGE,
} from '../constants.js';

const OT_PAUSE_TIME = 1.5; // short pause when entering overtime (no goal)

export class MatchState {
  constructor() {
    this.phase = 'countdown';
    this.score = { blue: 0, orange: 0 };
    this.clock = MATCH_LENGTH;
    this.overtime = false;
    this.countdownT = KICKOFF_COUNTDOWN;
    this.pauseT = 0;
    this.winner = null;
    this.lastGoalTeam = null;
    // Internal: did the most recent goalPause start as a real goal (vs an OT-start pause)?
    this._goalPauseFromGoal = false;
  }

  reset() {
    this.phase = 'countdown';
    this.score.blue = 0;
    this.score.orange = 0;
    this.clock = MATCH_LENGTH;
    this.overtime = false;
    this.countdownT = KICKOFF_COUNTDOWN;
    this.pauseT = 0;
    this.winner = null;
    this.lastGoalTeam = null;
    this._goalPauseFromGoal = false;
  }

  isFrozen() {
    return this.phase === 'countdown';
  }

  /**
   * @param {number} dt
   * @param {Array<{type:string, [k:string]:any}>} events
   * @returns {Array<{type:'resetKickoff'} | {type:'matchEnd', winner:string|null}>}
   */
  update(dt, events) {
    const actions = [];

    // Goals are honored in play phase only. In other phases we still drain them defensively.
    let goalThisTick = null;
    if (events && events.length) {
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev && ev.type === 'goal' && this.phase === 'play') {
          goalThisTick = ev.team;
          break;
        }
      }
    }

    switch (this.phase) {
      case 'countdown': {
        this.countdownT -= dt;
        if (this.countdownT <= 0) {
          this.countdownT = 0;
          this.phase = 'play';
        }
        break;
      }

      case 'play': {
        // Tick clock first.
        if (this.overtime) {
          this.clock += dt;
        } else {
          this.clock -= dt;
          if (this.clock < 0) this.clock = 0;
        }

        if (goalThisTick) {
          // Score the goal.
          if (goalThisTick === TEAM_BLUE) this.score.blue++;
          else if (goalThisTick === TEAM_ORANGE) this.score.orange++;
          this.lastGoalTeam = goalThisTick;

          // Overtime golden goal: match ends immediately at end of goalPause.
          // Regulation: clock already at 0 at moment of goal? We still allow the goal to count.
          this.phase = 'goalPause';
          this.pauseT = GOAL_PAUSE_TIME;
          this._goalPauseFromGoal = true;
        } else if (!this.overtime && this.clock <= 0) {
          // Regulation time expired with no goal this tick.
          if (this.score.blue === this.score.orange) {
            // Enter overtime — short pause then kickoff reset.
            this.overtime = true;
            this.clock = 0;
            this.phase = 'goalPause';
            this.pauseT = OT_PAUSE_TIME;
            this._goalPauseFromGoal = false;
          } else {
            // Match over.
            this.phase = 'over';
            this.winner = this.score.blue > this.score.orange ? TEAM_BLUE : TEAM_ORANGE;
            actions.push({ type: 'matchEnd', winner: this.winner });
          }
        }
        break;
      }

      case 'goalPause': {
        this.pauseT -= dt;
        if (this.pauseT <= 0) {
          this.pauseT = 0;
          const cameFromGoal = this._goalPauseFromGoal;
          this._goalPauseFromGoal = false;

          if (cameFromGoal && this.overtime) {
            // Golden goal: match ends, winner is the team that scored.
            this.phase = 'over';
            this.winner = this.lastGoalTeam;
            actions.push({ type: 'matchEnd', winner: this.winner });
          } else if (cameFromGoal && !this.overtime && this.clock <= 0) {
            // Goal landed AT (or after) the buzzer in regulation.
            if (this.score.blue === this.score.orange) {
              // Goal tied it up — go to overtime kickoff.
              this.overtime = true;
              this.clock = 0;
              this.countdownT = KICKOFF_COUNTDOWN;
              this.phase = 'countdown';
              actions.push({ type: 'resetKickoff' });
            } else {
              this.phase = 'over';
              this.winner = this.score.blue > this.score.orange ? TEAM_BLUE : TEAM_ORANGE;
              actions.push({ type: 'matchEnd', winner: this.winner });
            }
          } else {
            // Normal goal during regulation OR overtime-start pause: reset kickoff.
            this.countdownT = KICKOFF_COUNTDOWN;
            this.phase = 'countdown';
            actions.push({ type: 'resetKickoff' });
          }
        }
        break;
      }

      case 'over':
      default:
        break;
    }

    return actions;
  }
}
