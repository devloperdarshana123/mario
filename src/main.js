import Phaser from "phaser";
import "./style.css";

const WORLD_HEIGHT = 480;
const GROUND_Y = WORLD_HEIGHT - 40;
const JUMP_VELOCITY = -580;
const THROW_COOLDOWN = 350;
const MAX_LIVES = 3;
const MAX_JUMPS = 2;
const INVINCIBLE_DURATION = 6000;
const BOSS_LEVEL_INTERVAL = 5;
const COMBO_WINDOW = 2000;
const HIGH_SCORE_KEY = "beebros-highscore";
const UNLOCKED_KEY = "beebros-unlocked";
const MENU_LEVEL_CAP = 24;

const HIGH_SCORES_KEY = "beebros-highscores";

const getHighScores = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(HIGH_SCORES_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};
const getHighScore = () => getHighScores()[0] ?? 0;
const setHighScoreIfBetter = (score) => {
  const scores = getHighScores();
  scores.push(score);
  scores.sort((a, b) => b - a);
  const top5 = scores.slice(0, 5);
  try {
    localStorage.setItem(HIGH_SCORES_KEY, JSON.stringify(top5));
    localStorage.removeItem(HIGH_SCORE_KEY); // old single-value key, no longer used
  } catch {
    // ignore storage errors (private browsing, etc.)
  }
  return top5[0] ?? score;
};

const getUnlockedLevel = () => {
  try {
    return Number(localStorage.getItem(UNLOCKED_KEY)) || 0;
  } catch {
    return 0;
  }
};
const unlockLevel = (levelIndex) => {
  const current = getUnlockedLevel();
  if (levelIndex > current) {
    try {
      localStorage.setItem(UNLOCKED_KEY, String(levelIndex));
    } catch {
      // ignore storage errors
    }
  }
};

// A visual theme per level, cycling every 3 levels, so the world actually
// looks different as you progress instead of just getting harder.
const THEMES = [
  { name: "Grassland", sky: "#87ceeb", hill: 0x16a34a, cloudAlpha: 0.9 },
  { name: "Cave", sky: "#334155", hill: 0x1e293b, cloudAlpha: 0.08 },
  { name: "Sunset Dunes", sky: "#fca5a5", hill: 0xdb2777, cloudAlpha: 0.55 },
];

// Named difficulty bands so the endless ramp still reads as a clear curve —
// "how hard is this level" at a glance, not just a raw level number.
const DIFFICULTY_TIERS = [
  { upTo: 3, label: "Easy", color: "#16a34a" },
  { upTo: 7, label: "Medium", color: "#ca8a04" },
  { upTo: 12, label: "Moderate", color: "#ea580c" },
  { upTo: 18, label: "Hard", color: "#dc2626" },
  { upTo: Infinity, label: "Extreme", color: "#7f1d1d" },
];
const getDifficultyTier = (levelIndex) => {
  const levelNumber = levelIndex + 1;
  return DIFFICULTY_TIERS.find((tier) => levelNumber <= tier.upTo);
};

// Web Audio API tones generated on the fly — no audio files to download,
// so sound (and the background music) work even with zero network access.
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone({ freqStart, freqEnd, duration, type = "sine", volume = 0.2 }) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, ctx.currentTime);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + duration);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}
const sfx = {
  coin: () => playTone({ freqStart: 880, freqEnd: 1760, duration: 0.15, type: "square", volume: 0.15 }),
  jump: () => playTone({ freqStart: 300, freqEnd: 500, duration: 0.12, type: "triangle", volume: 0.12 }),
  stomp: () => playTone({ freqStart: 220, freqEnd: 80, duration: 0.18, type: "sawtooth", volume: 0.18 }),
  throw: () => playTone({ freqStart: 500, freqEnd: 700, duration: 0.08, type: "square", volume: 0.1 }),
  hurt: () => playTone({ freqStart: 200, freqEnd: 60, duration: 0.3, type: "sawtooth", volume: 0.2 }),
  win: () => playTone({ freqStart: 523, freqEnd: 1046, duration: 0.5, type: "sine", volume: 0.2 }),
  levelUp: () => playTone({ freqStart: 660, freqEnd: 990, duration: 0.35, type: "triangle", volume: 0.18 }),
  power: () => playTone({ freqStart: 400, freqEnd: 1200, duration: 0.4, type: "sawtooth", volume: 0.15 }),
  roar: () => playTone({ freqStart: 90, freqEnd: 50, duration: 0.6, type: "sawtooth", volume: 0.18 }),
  dash: () => playTone({ freqStart: 200, freqEnd: 900, duration: 0.18, type: "sine", volume: 0.16 }),
};

// Haptic buzz on hits, on phones/browsers that support it (a no-op, silent
// no-op elsewhere — desktop browsers simply don't have navigator.vibrate).
function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ignore — vibration is a nice-to-have, never worth failing over
  }
}

// A short looping melody for ambient background music — just a handful of
// scheduled tones, so there's no audio file to fetch or bundle.
const MELODY = [392, 440, 494, 440, 392, 330, 349, 392];

// Boss appearance cycles through these palettes so every third boss
// encounter looks different, not just "the same monster again".
const BOSS_DESIGNS = [
  { aura: 0x7f1d1d, horn: 0x120a0e, body: 0x1c1017, spike: 0x0b0609, eye: 0xf97316, claw: 0xe5e7eb },
  { aura: 0x374151, horn: 0x1c2531, body: 0x4b5563, spike: 0x374151, eye: 0x4ade80, claw: 0xd1d5db },
  { aura: 0x581c87, horn: 0x2e1065, body: 0x6d28d9, spike: 0x4c1d95, eye: 0x22d3ee, claw: 0xe9d5ff },
];

// Shared input state fed by the on-screen touch controls (see index.html),
// read alongside the keyboard in Scene#update so the same code path drives
// both desktop and mobile/emulator play.
const touchState = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpPressed: false,
  throwPressed: false,
  dashPressed: false,
};

function wireTouchControls() {
  const bind = (id, onDown, onUp) => {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      onDown();
    };
    const up = (e) => {
      e.preventDefault();
      onUp?.();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("pointercancel", up);
  };

  bind(
    "btn-left",
    () => (touchState.left = true),
    () => (touchState.left = false),
  );
  bind(
    "btn-right",
    () => (touchState.right = true),
    () => (touchState.right = false),
  );
  bind(
    "btn-jump",
    () => {
      touchState.jumpHeld = true;
      touchState.jumpPressed = true;
    },
    () => (touchState.jumpHeld = false),
  );
  bind("btn-throw", () => (touchState.throwPressed = true));
  bind("btn-dash", () => (touchState.dashPressed = true));
}
wireTouchControls();

// Levels are generated endlessly — every level is a bit wider, has bigger
// jumps, and busier/faster enemies than the last, so there's no fixed final
// level and difficulty keeps ramping the further you get.
function buildLevel(levelIndex) {
  const difficulty = Math.min(levelIndex, 25); // cap the ramp so it stays winnable, not just faster forever
  const width = 2600 + levelIndex * 900;
  const heightsCycle = [360, 280, 200, 320, 240, 380, 260, 220, 300];

  // Gaps between platforms grow with difficulty, demanding more precise
  // (and higher) jumps in later levels.
  const gapBase = 190 + difficulty * 6;
  const gapVariance = [0, 40, 80];

  const platforms = [];
  const coinSpots = [];
  let x = 380;
  let i = 0;
  while (x < width - 400) {
    const y = heightsCycle[(i + levelIndex) % heightsCycle.length];
    platforms.push({ x, y, moving: i % 4 === 3 });
    coinSpots.push(x + 20);
    x += gapBase + gapVariance[i % gapVariance.length];
    i += 1;
  }

  const enemySpeed = Math.min(70 + difficulty * 14, 280);
  const patrolSpacing = Math.max(560 - difficulty * 18, 260);
  const patrolRange = 140 + difficulty * 6;
  // Ground enemy types, cycled so a level has real variety instead of one
  // creature repeated: Goomba (plain walker), Snail (slow — dodge with a
  // jump), Spiky (fast, chases), and from level 4 on, Spike Ball — a hazard
  // that hurts no matter how you touch it and can only be cleared with a
  // thrown stone, not a stomp.
  const ENEMY_TYPES = [
    { key: "goomba", speedMul: 1, points: 15, chases: true },
    { key: "snail", speedMul: 0.55, points: 20, chases: false },
    { key: "spiky", speedMul: 1.25, points: 20, chases: true },
  ];
  if (levelIndex >= 3) {
    ENEMY_TYPES.push({ key: "spikeball", speedMul: 0.5, points: 25, chases: false, hazardOnly: true });
  }
  const enemyPatrols = [];
  let ei = 0;
  for (let ex = 650; ex < width - 500; ex += patrolSpacing) {
    enemyPatrols.push({ from: ex, to: ex + patrolRange, type: ENEMY_TYPES[ei % ENEMY_TYPES.length] });
    ei += 1;
  }

  // Flying enemies patrol up near platform height, on a roughly every-other
  // platform, so jumping up to avoid the ground patrols isn't automatically
  // safe — the air route has its own threat too. From level 2 on, bats mix
  // in with wasps: faster and with a bigger, more erratic bob.
  const flyerSpeed = Math.min(50 + difficulty * 8, 160);
  const flyers = platforms
    .filter((_, i) => i % 2 === 1)
    .map((p, idx) => {
      const isBat = levelIndex >= 1 && idx % 2 === 1;
      return {
        x: p.x,
        baseY: p.y - 55,
        from: p.x - 90,
        to: p.x + 90,
        phase: p.x % 7,
        key: isBat ? "bat" : "flyer",
        speedMul: isBat ? 1.5 : 1,
        bobAmp: isBat ? 55 : 30,
        bobSpeed: isBat ? 180 : 300,
      };
    });

  // Some ground-type enemies also stand right on top of platforms (not just
  // the floor far below), so jumping up to a platform can put you face to
  // face with a goomba/snail/spiky there too, not just clear of every enemy.
  const platformEnemies = platforms
    .filter((_, i) => i % 3 === 0)
    .map((p, idx) => ({
      x: p.x,
      y: p.y - 22,
      from: p.x - 34,
      to: p.x + 34,
      type: ENEMY_TYPES[idx % ENEMY_TYPES.length],
    }));

  // One power star roughly a third of the way in, and a shield roughly
  // three-quarters in — spread out so the two power-ups don't cluster.
  const starPlatform = platforms[Math.floor(platforms.length / 3)];
  const star = starPlatform ? { x: starPlatform.x, y: starPlatform.y - 34 } : null;
  const shieldPlatform = platforms[Math.floor((platforms.length * 3) / 4)];
  const shield = shieldPlatform ? { x: shieldPlatform.x, y: shieldPlatform.y - 34 } : null;

  // A single mid-level checkpoint: touch it once and dying afterwards
  // respawns you there instead of all the way back at the start.
  const checkpointX = width / 2;

  const hasBoss = (levelIndex + 1) % BOSS_LEVEL_INTERVAL === 0;

  return {
    width,
    platforms,
    coinSpots,
    enemyPatrols,
    platformEnemies,
    enemySpeed,
    flyers,
    flyerSpeed,
    star,
    shield,
    checkpointX,
    hasBoss,
  };
}

// The title/level-select screen. Kept as its own scene (rather than an
// overlay) so it gets a clean slate — no leftover gameplay objects, timers,
// or physics state to worry about when the player backs out to it.
class MenuScene extends Phaser.Scene {
  constructor() {
    super("menu");
  }

  preload() {
    const g = this.add.graphics();

    g.fillStyle(0xf5c518, 1);
    g.fillRoundedRect(2, 8, 24, 30, 8);
    g.fillStyle(0x1f2937, 1);
    g.fillRect(2, 16, 24, 6);
    g.fillRect(2, 26, 24, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(9, 14, 3.2);
    g.fillCircle(19, 14, 3.2);
    g.fillStyle(0x111827, 1);
    g.fillCircle(9, 14, 1.5);
    g.fillCircle(19, 14, 1.5);
    g.fillStyle(0x111827, 1);
    g.fillTriangle(11, 38, 17, 38, 14, 44);
    g.generateTexture("menu-bee", 28, 44);
    g.clear();

    g.fillStyle(0x328f97, 1);
    g.fillRoundedRect(0, 0, 280, 52, 26);
    g.generateTexture("menu-btn", 280, 52);
    g.clear();
    g.fillStyle(0x4fb8b2, 1);
    g.fillRoundedRect(0, 0, 280, 52, 26);
    g.generateTexture("menu-btn-hover", 280, 52);
    g.clear();

    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, 52, 52, 14);
    g.generateTexture("level-btn", 52, 52);
    g.destroy();
  }

  create() {
    this.cameras.main.setBackgroundColor("#87ceeb");
    const cx = this.scale.width / 2;

    this.add.text(cx, 56, "🐝 Bee Bros", {
      fontFamily: "sans-serif",
      fontSize: "40px",
      fontStyle: "bold",
      color: "#173a40",
    }).setOrigin(0.5);
    this.add.text(cx, 96, "A Mario-style adventure", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#416166",
    }).setOrigin(0.5);

    const bee = this.add.image(cx, 150, "menu-bee").setScale(2.2);
    this.tweens.add({ targets: bee, y: 140, duration: 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    const playBtn = this.add.image(cx, 216, "menu-btn").setInteractive({ useHandCursor: true });
    this.add.text(cx, 216, "▶  Play", {
      fontFamily: "sans-serif",
      fontSize: "20px",
      fontStyle: "bold",
      color: "#ffffff",
    }).setOrigin(0.5);
    playBtn.on("pointerover", () => playBtn.setTexture("menu-btn-hover"));
    playBtn.on("pointerout", () => playBtn.setTexture("menu-btn"));
    playBtn.on("pointerdown", () => this.scene.start("main", { levelIndex: 0, score: 0, lives: MAX_LIVES }));

    this.add.text(cx, 262, "Select a level", {
      fontFamily: "sans-serif",
      fontSize: "15px",
      fontStyle: "bold",
      color: "#173a40",
    }).setOrigin(0.5);

    const unlocked = Math.min(getUnlockedLevel(), MENU_LEVEL_CAP - 1);
    const cols = 6;
    const cellSize = 60;
    const gridWidth = cols * cellSize;
    const startX = cx - gridWidth / 2 + cellSize / 2;

    for (let i = 0; i <= unlocked; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = startX + col * cellSize;
      const by = 296 + row * cellSize;
      const tier = getDifficultyTier(i);

      const btn = this.add.image(bx, by, "level-btn").setInteractive({ useHandCursor: true });
      btn.setTint(Phaser.Display.Color.HexStringToColor(tier.color).color);
      this.add.text(bx, by, `${i + 1}`, {
        fontFamily: "sans-serif",
        fontSize: "18px",
        fontStyle: "bold",
        color: "#ffffff",
      }).setOrigin(0.5);

      btn.on("pointerover", () => btn.setScale(1.08));
      btn.on("pointerout", () => btn.setScale(1));
      btn.on("pointerdown", () => this.scene.start("main", { levelIndex: i, score: 0, lives: MAX_LIVES }));
    }

    const scores = getHighScores();
    const scoresText = scores.length ? scores.map((s, i) => `${i + 1}. ${s}`).join("   ") : "No scores yet";
    this.add.text(cx, this.scale.height - 18, `🏆 Top scores: ${scoresText}`, {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#416166",
    }).setOrigin(0.5);
  }
}

class MainScene extends Phaser.Scene {
  constructor() {
    super("main");
  }

  init(data) {
    this.levelIndex = data.levelIndex ?? 0;
    this.score = data.score ?? 0;
    this.scoreAtLevelStart = this.score;
    this.checkpointX = data.checkpointX ?? 80;
    this.bossAlreadyCleared = data.bossDefeated ?? false;
    this.lives = data.lives ?? MAX_LIVES;
    this.gameOver = false;
    this.isPaused = false;
    this.lastThrowTime = 0;
    this.endScreenButtons = [];
    this.pauseNodes = null;
    this.jumpsUsed = 0;
    this.wasOnGround = true;
    this.invincible = false;
    this.invincibleUntil = 0;
    this.bossDefeated = true;
    this.hasBoss = false;
    this.theme = THEMES[this.levelIndex % THEMES.length];
    this.coinsCollected = 0;
    this.totalCoins = 0;
    this.comboCount = 0;
    this.lastKillTime = -Infinity;
  }

  preload() {
    const g = this.add.graphics();

    // Player — a small bee-like hero with eyes and a stinger, matching the
    // NearBee mascot instead of a generic block.
    g.fillStyle(0xf5c518, 1);
    g.fillRoundedRect(2, 8, 24, 30, 8);
    g.fillStyle(0x1f2937, 1);
    g.fillRect(2, 16, 24, 6);
    g.fillRect(2, 26, 24, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(9, 14, 3.2);
    g.fillCircle(19, 14, 3.2);
    g.fillStyle(0x111827, 1);
    g.fillCircle(9, 14, 1.5);
    g.fillCircle(19, 14, 1.5);
    g.fillStyle(0x111827, 1);
    g.fillTriangle(11, 38, 17, 38, 14, 44);
    g.generateTexture("player", 28, 44);
    g.clear();

    g.fillStyle(0x8b5a2b, 1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle(0x6b4423, 1);
    for (let i = 0; i < 4; i++) g.fillRect(4 + i * 16, 20 + (i % 2) * 14, 6, 6);
    g.fillStyle(0x4ade80, 1);
    g.fillRect(0, 0, 64, 12);
    g.fillStyle(0x22c55e, 1);
    g.fillRect(0, 8, 64, 4);
    g.generateTexture("ground", 64, 64);
    g.clear();

    g.fillStyle(0xb45309, 1);
    g.fillRect(0, 0, 96, 24);
    g.lineStyle(2, 0x7c2d12, 1);
    for (let px = 0; px <= 96; px += 24) g.lineBetween(px, 0, px, 24);
    g.lineBetween(0, 12, 96, 12);
    g.fillStyle(0x4ade80, 1);
    g.fillRect(0, 0, 96, 5);
    g.generateTexture("platform", 96, 24);
    g.clear();

    g.fillStyle(0xfacc15, 1);
    g.fillCircle(10, 10, 10);
    g.fillStyle(0xfde68a, 1);
    g.fillCircle(10, 10, 6);
    g.fillStyle(0xfacc15, 1);
    g.fillCircle(10, 10, 3);
    g.generateTexture("coin", 20, 20);
    g.clear();

    // Spiky — fast, aggressive, chases the player once nearby.
    g.fillStyle(0xdc2626, 1);
    g.fillRoundedRect(0, 4, 30, 22, 8);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(9, 13, 3);
    g.fillCircle(21, 13, 3);
    g.fillStyle(0x111827, 1);
    g.fillCircle(9, 13, 1.4);
    g.fillCircle(21, 13, 1.4);
    g.lineStyle(2, 0x450a0a, 1);
    g.lineBetween(5, 7, 12, 9);
    g.lineBetween(25, 7, 18, 9);
    g.generateTexture("spiky", 30, 26);
    g.clear();

    // Goomba — a plain brown walker, the classic "just stomp it" enemy.
    g.fillStyle(0x92400e, 1);
    g.fillEllipse(15, 16, 28, 20);
    g.fillStyle(0x78350f, 1);
    g.fillRect(2, 22, 10, 6);
    g.fillRect(18, 22, 10, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(10, 12, 3.5);
    g.fillCircle(20, 12, 3.5);
    g.fillStyle(0x111827, 1);
    g.fillCircle(10, 12, 1.6);
    g.fillCircle(20, 12, 1.6);
    g.lineStyle(2, 0x451a03, 1);
    g.lineBetween(5, 6, 13, 9);
    g.lineBetween(25, 6, 17, 9);
    g.generateTexture("goomba", 30, 28);
    g.clear();

    // Snail — slow-moving with a shell; the "just jump over it" enemy.
    g.fillStyle(0xd9f99d, 1);
    g.fillEllipse(15, 20, 26, 10);
    g.fillStyle(0x16a34a, 1);
    g.fillCircle(13, 12, 12);
    g.fillStyle(0x15803d, 1);
    g.strokeCircle(13, 12, 12);
    g.lineStyle(1.5, 0x166534, 1);
    g.strokeCircle(13, 12, 7);
    g.strokeCircle(13, 12, 3);
    g.fillStyle(0xd9f99d, 1);
    g.fillCircle(27, 6, 2.4);
    g.fillCircle(31, 6, 2.4);
    g.fillStyle(0x111827, 1);
    g.fillCircle(27, 6, 1);
    g.fillCircle(31, 6, 1);
    g.generateTexture("snail", 34, 26);
    g.clear();

    // Spike ball — hurts from every side, only stones can clear it.
    g.fillStyle(0x374151, 1);
    g.fillCircle(14, 14, 12);
    g.fillStyle(0x9ca3af, 1);
    for (let a = 0; a < 8; a++) {
      const rad = (a / 8) * Math.PI * 2;
      const sx = 14 + Math.cos(rad) * 12;
      const sy = 14 + Math.sin(rad) * 12;
      const tx = 14 + Math.cos(rad) * 18;
      const ty = 14 + Math.sin(rad) * 18;
      g.fillTriangle(sx - 2, sy - 2, sx + 2, sy + 2, tx, ty);
    }
    g.fillStyle(0xef4444, 1);
    g.fillCircle(10, 12, 2);
    g.fillCircle(18, 12, 2);
    g.generateTexture("spikeball", 28, 28);
    g.clear();

    // Flying enemy — a wasp that hovers near platform height.
    g.fillStyle(0xffffff, 0.55);
    g.fillEllipse(6, 6, 12, 6);
    g.fillEllipse(22, 6, 12, 6);
    g.fillStyle(0x1f2937, 1);
    g.fillEllipse(14, 12, 20, 14);
    g.fillStyle(0xf59e0b, 1);
    g.fillRect(8, 8, 4, 8);
    g.fillRect(16, 8, 4, 8);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(10, 10, 2.4);
    g.fillCircle(18, 10, 2.4);
    g.fillStyle(0x111827, 1);
    g.fillCircle(10, 10, 1.1);
    g.fillCircle(18, 10, 1.1);
    g.generateTexture("flyer", 28, 20);
    g.clear();

    // Bat — faster and more erratic than the wasp; a second air threat that
    // shows up from mid-difficulty levels on.
    g.fillStyle(0x1e1b2e, 1);
    g.fillTriangle(0, 10, 12, 2, 12, 12);
    g.fillTriangle(28, 10, 16, 2, 16, 12);
    g.fillEllipse(14, 12, 14, 12);
    g.fillStyle(0xdc2626, 1);
    g.fillCircle(10, 10, 2);
    g.fillCircle(18, 10, 2);
    g.fillStyle(0xf1f5f9, 1);
    g.fillTriangle(11, 14, 13, 18, 15, 14);
    g.fillTriangle(15, 14, 17, 18, 19, 14);
    g.generateTexture("bat", 28, 22);
    g.clear();

    // Power star — grants brief invincibility.
    g.fillStyle(0xfde047, 1);
    g.fillTriangle(12, 0, 15, 9, 24, 12);
    g.fillTriangle(24, 12, 15, 15, 12, 24);
    g.fillTriangle(12, 24, 9, 15, 0, 12);
    g.fillTriangle(0, 12, 9, 9, 12, 0);
    g.fillStyle(0xf59e0b, 1);
    g.fillCircle(12, 12, 5);
    g.generateTexture("star", 24, 24);
    g.clear();

    // Shield power-up — a blue badge that blocks the next hit.
    g.fillStyle(0x3b82f6, 1);
    g.fillTriangle(12, 0, 24, 6, 24, 14);
    g.fillTriangle(12, 0, 0, 6, 0, 14);
    g.fillTriangle(0, 14, 12, 24, 24, 14);
    g.fillStyle(0xbfdbfe, 1);
    g.fillTriangle(12, 4, 19, 8, 19, 14);
    g.fillTriangle(12, 4, 5, 8, 5, 14);
    g.fillTriangle(5, 14, 12, 20, 19, 14);
    g.generateTexture("shield", 24, 24);
    g.clear();

    // Aura ring shown around the player while a shield is active.
    g.lineStyle(3, 0x3b82f6, 0.9);
    g.strokeCircle(20, 20, 18);
    g.generateTexture("shield-aura", 40, 40);
    g.clear();

    // Checkpoint banner — planted once reached, marks the new respawn spot.
    g.fillStyle(0x9ca3af, 1);
    g.fillRect(0, 0, 5, 70);
    g.fillStyle(0x3b82f6, 1);
    g.fillTriangle(5, 4, 5, 26, 34, 15);
    g.generateTexture("checkpoint", 34, 70);
    g.clear();
    g.fillStyle(0x9ca3af, 1);
    g.fillRect(0, 0, 5, 70);
    g.fillStyle(0x64748b, 1);
    g.fillTriangle(5, 4, 5, 26, 34, 15);
    g.generateTexture("checkpoint-unlit", 34, 70);
    g.clear();

    // Thrown stone
    g.fillStyle(0x78716c, 1);
    g.fillCircle(7, 7, 7);
    g.fillStyle(0x57534e, 1);
    g.fillCircle(5, 5, 2);
    g.generateTexture("stone", 14, 14);
    g.clear();

    // Dust puff for the running/landing particle trail.
    g.fillStyle(0x9ca3af, 0.8);
    g.fillCircle(4, 4, 4);
    g.generateTexture("dust", 8, 8);
    g.clear();

    g.fillStyle(0x9ca3af, 1);
    g.fillRect(0, 0, 6, 140);
    g.generateTexture("pole", 6, 140);
    g.clear();

    g.fillStyle(0x22c55e, 1);
    g.fillTriangle(0, 0, 40, 10, 0, 20);
    g.generateTexture("flag", 40, 20);
    g.clear();

    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(20, 20, 18);
    g.fillCircle(40, 14, 14);
    g.fillCircle(58, 20, 16);
    g.fillRect(14, 20, 60, 14);
    g.generateTexture("cloud", 88, 36);
    g.clear();

    // Distant mountain silhouette — the furthest, slowest-scrolling layer,
    // giving the parallax more depth than clouds + hills alone.
    g.fillStyle(0x000000, 0.15);
    g.fillTriangle(0, 120, 60, 20, 120, 120);
    g.fillTriangle(80, 120, 150, 40, 220, 120);
    g.generateTexture("mountain", 220, 120);
    g.clear();

    g.fillStyle(this.theme.hill, 0.55);
    g.fillCircle(80, 90, 90);
    g.generateTexture("hill", 160, 100);
    g.clear();

    // Full (red) and empty (outlined) heart icons for the lives display.
    const drawHeart = (fillColor, outlineColor) => {
      g.fillStyle(fillColor, 1);
      g.fillCircle(7, 7, 6);
      g.fillCircle(15, 7, 6);
      g.fillTriangle(2, 9, 20, 9, 11, 22);
      if (outlineColor !== undefined) {
        g.lineStyle(2, outlineColor, 1);
        g.strokeCircle(7, 7, 6);
        g.strokeCircle(15, 7, 6);
      }
    };
    drawHeart(0xef4444, 0x991b1b);
    g.generateTexture("heart-full", 22, 24);
    g.clear();
    drawHeart(0x374151);
    g.generateTexture("heart-empty", 22, 24);
    g.clear();

    // End-screen panel: cream card with a teal top banner and a soft border.
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, 460, 320, 24);
    g.lineStyle(4, 0x328f97, 1);
    g.strokeRoundedRect(2, 2, 456, 316, 22);
    g.fillStyle(0x4fb8b2, 1);
    g.fillRoundedRect(0, 0, 460, 64, { tl: 24, tr: 24, bl: 0, br: 0 });
    g.generateTexture("panel", 460, 320);
    g.clear();

    // Two button states — a plain rounded pill and a lighter "hover" one —
    // swapped on pointer events instead of relying on tinting.
    g.fillStyle(0x328f97, 1);
    g.fillRoundedRect(0, 0, 300, 52, 26);
    g.generateTexture("button-bg", 300, 52);
    g.clear();
    g.fillStyle(0x4fb8b2, 1);
    g.fillRoundedRect(0, 0, 300, 52, 26);
    g.generateTexture("button-bg-hover", 300, 52);
    g.clear();

    // A handful of colored squares to burst as confetti on a level win.
    [0xf59e0b, 0xef4444, 0x22c55e, 0x3b82f6, 0xa855f7].forEach((color, i) => {
      g.fillStyle(color, 1);
      g.fillRect(0, 0, 10, 10);
      g.generateTexture(`confetti-${i}`, 10, 10);
      g.clear();
    });

    // Boss — a horned, snarling monster: dark jagged body, glowing slit
    // eyes, fanged mouth, and claws, with a faint aura behind it. The
    // palette cycles (see BOSS_DESIGNS) so every third boss looks distinct.
    const design = BOSS_DESIGNS[Math.floor(this.levelIndex / BOSS_LEVEL_INTERVAL) % BOSS_DESIGNS.length];

    g.fillStyle(design.aura, 0.3);
    g.fillCircle(36, 33, 40);

    g.fillStyle(design.horn, 1);
    g.fillTriangle(10, 16, 20, 0, 25, 18);
    g.fillTriangle(62, 16, 52, 0, 47, 18);

    g.fillStyle(design.body, 1);
    g.fillRoundedRect(4, 14, 64, 46, 16);

    g.fillStyle(design.spike, 1);
    for (let i = 0; i < 4; i++) {
      const sx = 14 + i * 13;
      g.fillTriangle(sx, 18, sx + 5, 6, sx + 10, 18);
    }

    g.fillStyle(design.eye, 1);
    g.fillCircle(22, 34, 7.5);
    g.fillCircle(50, 34, 7.5);
    g.fillStyle(0x000000, 1);
    g.fillRect(20.5, 28, 3, 12);
    g.fillRect(48.5, 28, 3, 12);

    g.fillStyle(0x000000, 1);
    g.fillRoundedRect(18, 44, 36, 14, 6);
    g.fillStyle(0xf1f5f9, 1);
    g.fillTriangle(21, 44, 26, 53, 31, 44);
    g.fillTriangle(33, 44, 38, 55, 43, 44);
    g.fillTriangle(45, 44, 50, 53, 51, 44);

    g.fillStyle(design.claw, 1);
    g.fillTriangle(2, 56, 12, 44, 16, 58);
    g.fillTriangle(70, 56, 60, 44, 56, 58);

    g.generateTexture("boss", 72, 62);
    g.destroy();
  }

  create() {
    const level = buildLevel(this.levelIndex);
    this.levelWidth = level.width;
    this.hasBoss = level.hasBoss;
    this.bossDefeated = !level.hasBoss || this.bossAlreadyCleared;
    this.totalCoins = level.coinSpots.length;

    this.physics.world.setBounds(0, 0, level.width, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, level.width, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor(this.theme.sky);

    this.add.tileSprite(0, GROUND_Y - 90, level.width, 120, "mountain").setScrollFactor(0.08).setOrigin(0, 0).setAlpha(0.5);
    this.add
      .tileSprite(0, 60, level.width, 40, "cloud")
      .setScrollFactor(0.2)
      .setOrigin(0, 0)
      .setAlpha(this.theme.cloudAlpha);
    this.add.tileSprite(0, GROUND_Y - 60, level.width, 100, "hill").setScrollFactor(0.5).setOrigin(0, 0);

    this.platforms = this.physics.add.staticGroup();
    for (let x = 0; x < level.width; x += 64) {
      this.platforms.create(x + 32, GROUND_Y + 20, "ground");
    }

    // Most platforms are fixed; every 4th one bobs up and down, driven by
    // velocity (not a teleport) so a resting player is correctly carried
    // along by Arcade Physics' own collision response.
    this.movingPlatforms = this.physics.add.group({ allowGravity: false, immovable: true });
    level.platforms.forEach(({ x, y, moving }) => {
      if (moving) {
        const mp = this.movingPlatforms.create(x, y, "platform");
        mp.minY = y - 60;
        mp.maxY = y + 60;
        mp.setVelocityY(60);
      } else {
        this.platforms.create(x, y, "platform");
      }
    });

    this.player = this.physics.add.sprite(this.checkpointX, GROUND_Y - 60, "player");
    this.player.setCollideWorldBounds(true);
    this.player.setBounce(0.05);
    this.player.setSize(24, 40).setOffset(2, 4);
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.movingPlatforms);

    this.dustEmitter = this.add.particles(0, 0, "dust", {
      speed: { min: 20, max: 60 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.5, end: 0 },
      lifespan: 300,
      quantity: 1,
      frequency: 90,
    });
    this.dustEmitter.stop();

    this.coins = this.physics.add.group();
    level.coinSpots.forEach((x, i) => {
      const coin = this.coins.create(x, GROUND_Y - 120 - (i % 3) * 20, "coin");
      coin.body.allowGravity = false;
      this.tweens.add({
        targets: coin,
        scaleX: 0.2,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: i * 60,
      });
    });
    this.physics.add.overlap(this.player, this.coins, this.collectCoin, null, this);

    // Power star: a rare pickup that grants brief invincibility.
    this.stars = this.physics.add.group();
    if (level.star) {
      const star = this.stars.create(level.star.x, level.star.y, "star");
      star.body.allowGravity = false;
      this.tweens.add({ targets: star, angle: 360, duration: 1500, repeat: -1 });
    }
    this.physics.add.overlap(this.player, this.stars, this.collectStar, null, this);

    // Shield power-up: absorbs the next hit instead of costing a life.
    this.hasShield = false;
    this.shields = this.physics.add.group();
    if (level.shield) {
      const shield = this.shields.create(level.shield.x, level.shield.y, "shield");
      shield.body.allowGravity = false;
      this.tweens.add({ targets: shield, y: shield.y - 8, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    this.physics.add.overlap(this.player, this.shields, this.collectShield, null, this);
    this.shieldAura = this.add.image(this.player.x, this.player.y, "shield-aura").setVisible(false);

    // Mid-level checkpoint: touching it moves future respawns here.
    this.checkpointReached = this.checkpointX > 80;
    this.checkpointMarker = this.physics.add.staticImage(
      level.checkpointX,
      GROUND_Y - 35,
      this.checkpointReached ? "checkpoint" : "checkpoint-unlit",
    );
    this.physics.add.overlap(this.player, this.checkpointMarker, this.reachCheckpoint, null, this);

    this.enemies = this.physics.add.group();
    level.enemyPatrols.forEach(({ from, to, type }) => {
      const enemy = this.enemies.create(from, GROUND_Y - 13, type.key);
      enemy.setCollideWorldBounds(true);
      const speed = level.enemySpeed * type.speedMul;
      enemy.setVelocityX(speed);
      enemy.patrolFrom = from;
      enemy.patrolTo = to;
      enemy.speed = speed;
      enemy.points = type.points;
      enemy.chases = type.chases;
      enemy.hazardOnly = type.hazardOnly ?? false;
    });
    level.platformEnemies.forEach(({ x, y, from, to, type }) => {
      const enemy = this.enemies.create(x, y, type.key);
      enemy.setCollideWorldBounds(true);
      const speed = level.enemySpeed * type.speedMul * 0.7;
      enemy.setVelocityX(speed);
      enemy.patrolFrom = from;
      enemy.patrolTo = to;
      enemy.speed = speed;
      enemy.points = type.points;
      enemy.chases = false; // patrol only — chasing near a platform edge risks walking off
      enemy.hazardOnly = type.hazardOnly ?? false;
    });
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.collider(this.enemies, this.movingPlatforms);
    this.physics.add.collider(this.player, this.enemies, this.hitEnemy, null, this);

    // Flying enemies hover near platform height so jumping up to dodge the
    // ground patrols isn't automatically a safe route.
    this.flyers = this.physics.add.group();
    level.flyers.forEach((f) => {
      const flyer = this.flyers.create(f.x, f.baseY, f.key);
      flyer.body.allowGravity = false;
      const speed = level.flyerSpeed * f.speedMul;
      flyer.setVelocityX(speed);
      flyer.patrolFrom = f.from;
      flyer.patrolTo = f.to;
      flyer.speed = speed;
      flyer.baseY = f.baseY;
      flyer.phase = f.phase;
      flyer.bobAmp = f.bobAmp;
      flyer.bobSpeed = f.bobSpeed;
    });
    this.physics.add.overlap(this.player, this.flyers, this.hitEnemy, null, this);

    // Thrown stones: no gravity, straight shot, destroyed on hitting an
    // enemy or a wall/platform so they can't be spammed through the level.
    this.projectiles = this.physics.add.group();
    this.physics.add.collider(this.projectiles, this.platforms, (p) => p.destroy());
    this.physics.add.overlap(this.projectiles, this.enemies, this.hitEnemyWithStone, null, this);
    this.physics.add.overlap(this.projectiles, this.flyers, this.hitEnemyWithStone, null, this);

    // Boss: spawns every BOSS_LEVEL_INTERVAL-th level and blocks the flag
    // until it's taken three hits (stomp or stone).
    this.boss = null;
    if (level.hasBoss && !this.bossAlreadyCleared) {
      const bossX = level.width - 260;
      const boss = this.physics.add.sprite(bossX, GROUND_Y - 34, "boss");
      boss.setCollideWorldBounds(true);
      boss.hitsRemaining = 3;
      boss.patrolFrom = bossX - 160;
      boss.patrolTo = bossX + 160;
      boss.speed = 90;
      boss.setVelocityX(boss.speed);
      this.physics.add.collider(boss, this.platforms);
      this.physics.add.collider(this.player, boss, this.hitBoss, null, this);
      this.physics.add.overlap(this.projectiles, boss, this.hitBossWithStone, null, this);
      this.boss = boss;

      // A slow menacing "breathing" pulse so the boss reads as alive/scary
      // even while just patrolling.
      this.tweens.add({ targets: boss, scaleX: 1.06, scaleY: 0.94, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      sfx.roar();
      this.bossGrowlEvent = this.time.addEvent({ delay: 3500, loop: true, callback: () => sfx.roar() });

      const barX = this.scale.width / 2;
      this.bossHealthBg = this.add.rectangle(barX, 78, 204, 16, 0x000000, 0.4).setScrollFactor(0);
      this.bossHealthBar = this.add.rectangle(barX - 100, 78, 200, 12, 0xdc2626).setOrigin(0, 0.5).setScrollFactor(0);
      this.bossHealthLabel = this.add
        .text(barX, 78, "3 / 3 HP", { fontFamily: "sans-serif", fontSize: "11px", fontStyle: "bold", color: "#ffffff" })
        .setOrigin(0.5)
        .setScrollFactor(0);
      this.add
        .text(barX, 60, "⚠ Defeat the boss!", {
          fontFamily: "sans-serif",
          fontSize: "14px",
          fontStyle: "bold",
          color: "#ffffff",
          backgroundColor: "#00000066",
          padding: { x: 6, y: 2 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0);
    }

    this.add.image(level.width - 80, GROUND_Y - 90, "pole").setOrigin(0.5, 1);
    this.flag = this.physics.add.staticImage(level.width - 68, GROUND_Y - 150, "flag");
    this.physics.add.overlap(this.player, this.flag, this.winLevel, null, this);

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys("W,A,S,D,SPACE,F,P,SHIFT");
    this.facing = 1;
    this.isDashing = false;
    this.canDash = true;

    this.scoreText = this.add.text(16, 16, `Score: ${this.score}`, {
      fontFamily: "sans-serif",
      fontSize: "20px",
      color: "#173a40",
      backgroundColor: "#ffffffaa",
      padding: { x: 8, y: 4 },
    }).setScrollFactor(0);

    const tier = getDifficultyTier(this.levelIndex);
    this.levelText = this.add.text(16, 48, `Level ${this.levelIndex + 1} · ${this.theme.name}`, {
      fontFamily: "sans-serif",
      fontSize: "16px",
      color: "#173a40",
      backgroundColor: "#ffffffaa",
      padding: { x: 8, y: 4 },
    }).setScrollFactor(0);

    this.difficultyText = this.add
      .text(16, 76, `⚔ ${tier.label}`, {
        fontFamily: "sans-serif",
        fontSize: "14px",
        fontStyle: "bold",
        color: "#ffffff",
        backgroundColor: tier.color,
        padding: { x: 8, y: 3 },
      })
      .setScrollFactor(0);

    this.highScoreText = this.add
      .text(this.scale.width - 16, 16, `Best: ${getHighScore()}`, {
        fontFamily: "sans-serif",
        fontSize: "16px",
        color: "#173a40",
        backgroundColor: "#ffffffaa",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0);

    this.pauseBtn = this.add
      .text(this.scale.width - 16, 48, "⏸", {
        fontFamily: "sans-serif",
        fontSize: "18px",
        color: "#173a40",
        backgroundColor: "#ffffffaa",
        padding: { x: 9, y: 3 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.pauseBtn.on("pointerdown", () => this.togglePause());

    this.heartIcons = [];
    for (let i = 0; i < MAX_LIVES; i++) {
      const heart = this.add.image(16 + i * 26, 106, "heart-full").setOrigin(0, 0).setScrollFactor(0);
      this.heartIcons.push(heart);
    }
    this.updateHearts();

    // Ambient background music: a short melody looping on a timer.
    this.musicIndex = 0;
    this.musicEvent = this.time.addEvent({
      delay: 280,
      loop: true,
      callback: () => {
        playTone({ freqStart: MELODY[this.musicIndex], duration: 0.25, type: "triangle", volume: 0.05 });
        this.musicIndex = (this.musicIndex + 1) % MELODY.length;
      },
    });
  }

  togglePause() {
    if (this.gameOver) return;

    if (this.isPaused) {
      this.isPaused = false;
      this.physics.resume();
      this.pauseNodes?.forEach((n) => n.destroy());
      this.pauseNodes = null;
      return;
    }

    this.isPaused = true;
    this.physics.pause();

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const overlay = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.55).setScrollFactor(0);
    const title = this.add
      .text(cx, cy - 70, "⏸ Paused", { fontFamily: "sans-serif", fontSize: "30px", fontStyle: "bold", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0);

    const resumeBg = this.add.image(cx, cy, "button-bg").setScrollFactor(0).setInteractive({ useHandCursor: true });
    const resumeLabel = this.add
      .text(cx, cy, "▶  Resume", { fontFamily: "sans-serif", fontSize: "18px", fontStyle: "bold", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0);
    resumeBg.on("pointerover", () => resumeBg.setTexture("button-bg-hover"));
    resumeBg.on("pointerout", () => resumeBg.setTexture("button-bg"));
    resumeBg.on("pointerdown", () => this.togglePause());

    const menuBg = this.add.image(cx, cy + 62, "button-bg").setScrollFactor(0).setInteractive({ useHandCursor: true });
    const menuLabel = this.add
      .text(cx, cy + 62, "🏠  Main Menu", { fontFamily: "sans-serif", fontSize: "18px", fontStyle: "bold", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0);
    menuBg.on("pointerover", () => menuBg.setTexture("button-bg-hover"));
    menuBg.on("pointerout", () => menuBg.setTexture("button-bg"));
    menuBg.on("pointerdown", () => {
      this.musicEvent?.remove();
      this.scene.start("menu");
    });

    this.pauseNodes = [overlay, title, resumeBg, resumeLabel, menuBg, menuLabel];
  }

  showEndScreen(title, buttonDefs, { celebrate = false, accent = "#173a40" } = {}) {
    this.gameOver = true;
    this.physics.pause();
    this.musicEvent?.remove();

    const finalHighScore = setHighScoreIfBetter(this.score);
    const isNewHighScore = celebrate && this.score > 0 && finalHighScore === this.score;

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const nodes = [];

    const overlay = this.add
      .rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.45)
      .setScrollFactor(0);
    nodes.push(overlay);

    const panel = this.add.image(cx, cy - 20, "panel").setScrollFactor(0);
    nodes.push(panel);

    const banner = this.add
      .text(cx, panel.y - panel.displayHeight / 2 + 32, celebrate ? "🎉 Congratulations! 🎉" : "Try again!", {
        fontFamily: "sans-serif",
        fontSize: "20px",
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    nodes.push(banner);

    const fullTitle = isNewHighScore ? `${title}\n🏆 New high score: ${finalHighScore}!` : title;
    const titleText = this.add
      .text(cx, panel.y - 6, fullTitle, {
        fontFamily: "sans-serif",
        fontSize: 20,
        fontStyle: "bold",
        color: accent,
        align: "center",
        wordWrap: { width: panel.displayWidth - 60 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    nodes.push(titleText);

    let buttonY = titleText.y + titleText.height / 2 + 34;
    buttonDefs.forEach((def) => {
      const bg = this.add.image(cx, buttonY, "button-bg").setScrollFactor(0).setInteractive({ useHandCursor: true });
      const label = this.add
        .text(cx, buttonY, def.label, {
          fontFamily: "sans-serif",
          fontSize: "18px",
          fontStyle: "bold",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setScrollFactor(0);

      bg.on("pointerover", () => bg.setTexture("button-bg-hover").setScale(1.04));
      bg.on("pointerout", () => bg.setTexture("button-bg").setScale(1));
      bg.on("pointerdown", () => {
        this.endScreenButtons.forEach((b) => b.destroy());
        def.onClick();
      });

      nodes.push(bg, label);
      buttonY += 58;
    });

    const menuLink = this.add
      .text(cx, this.scale.height - 22, "🏠 Back to Menu", {
        fontFamily: "sans-serif",
        fontSize: "14px",
        fontStyle: "bold",
        color: "#ffffff",
        backgroundColor: "#00000055",
        padding: { x: 8, y: 3 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    menuLink.on("pointerdown", () => {
      this.endScreenButtons.forEach((b) => b.destroy());
      this.scene.start("menu");
    });
    nodes.push(menuLink);

    this.endScreenButtons = nodes;

    if (celebrate) {
      [0, 1, 2, 3, 4].forEach((i) => {
        const emitter = this.add.particles(0, 0, `confetti-${i}`, {
          x: { min: 0, max: this.scale.width },
          y: -20,
          lifespan: 2200,
          speedY: { min: 120, max: 260 },
          speedX: { min: -60, max: 60 },
          rotate: { min: 0, max: 360 },
          gravityY: 200,
          quantity: 1,
          frequency: 40,
          scrollFactor: 0,
        });
        this.time.delayedCall(1200, () => emitter.stop());
        this.time.delayedCall(3500, () => emitter.destroy());
        this.endScreenButtons.push(emitter);
      });
    }
  }

  updateHearts() {
    this.heartIcons.forEach((heart, i) => {
      heart.setTexture(i < this.lives ? "heart-full" : "heart-empty");
    });
  }

  showFloatingText(x, y, text, color) {
    const t = this.add
      .text(x, y, text, { fontFamily: "sans-serif", fontSize: "16px", fontStyle: "bold", color })
      .setOrigin(0.5);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 800, onComplete: () => t.destroy() });
  }

  registerKill(basePoints, x, y) {
    const now = this.time.now;
    this.comboCount = now - this.lastKillTime < COMBO_WINDOW ? this.comboCount + 1 : 1;
    this.lastKillTime = now;

    const bonus = (this.comboCount - 1) * 5;
    const total = basePoints + bonus;
    this.score += total;
    this.scoreText.setText(`Score: ${this.score}`);

    if (this.comboCount > 1) {
      this.showFloatingText(x, y, `Combo x${this.comboCount}! +${total}`, "#f59e0b");
    }
  }

  playJumpSquash() {
    this.tweens.killTweensOf(this.player);
    this.player.setScale(0.85, 1.2);
    this.tweens.add({ targets: this.player, scaleX: 1, scaleY: 1, duration: 220, ease: "Back.Out" });
  }

  playLandSquash() {
    this.tweens.killTweensOf(this.player);
    this.player.setScale(1.25, 0.8);
    this.tweens.add({ targets: this.player, scaleX: 1, scaleY: 1, duration: 180, ease: "Back.Out" });
  }

  collectCoin(player, coin) {
    coin.destroy();
    sfx.coin();
    this.coinsCollected += 1;
    this.score += 10;
    this.scoreText.setText(`Score: ${this.score}`);
  }

  collectStar(player, star) {
    star.destroy();
    sfx.power();
    this.invincible = true;
    this.invincibleUntil = this.time.now + INVINCIBLE_DURATION;
    this.flashTween?.stop();
    this.flashTween = this.tweens.add({
      targets: this.player,
      alpha: 0.4,
      duration: 120,
      yoyo: true,
      repeat: -1,
    });
  }

  collectShield(player, shield) {
    shield.destroy();
    sfx.power();
    this.hasShield = true;
    this.shieldAura.setVisible(true);
  }

  reachCheckpoint(player, marker) {
    if (this.checkpointReached) return;
    this.checkpointReached = true;
    this.checkpointX = marker.x;
    marker.setTexture("checkpoint");
    sfx.levelUp();
    this.showFloatingText(marker.x, marker.y - 50, "Checkpoint!", "#3b82f6");
  }

  endInvincibility() {
    this.invincible = false;
    this.flashTween?.stop();
    this.flashTween = null;
    this.player.setAlpha(1);
  }

  throwStone() {
    const now = this.time.now;
    if (now - this.lastThrowTime < THROW_COOLDOWN) return;
    this.lastThrowTime = now;

    const direction = this.player.flipX ? -1 : 1;
    const stone = this.projectiles.create(this.player.x + direction * 20, this.player.y - 6, "stone");
    stone.body.allowGravity = false;
    stone.setVelocityX(direction * 420);
    sfx.throw();

    this.time.delayedCall(1500, () => stone.destroy());
  }

  hitEnemyWithStone(stone, enemy) {
    const { x, y } = enemy;
    stone.destroy();
    enemy.destroy();
    sfx.stomp();
    this.registerKill(enemy.points ?? 15, x, y);
  }

  hitEnemy(player, enemy) {
    if (this.gameOver) return;
    const { x, y } = enemy;

    if (this.invincible || this.isDashing) {
      enemy.destroy();
      sfx.stomp();
      this.registerKill(enemy.points ?? 20, x, y);
      return;
    }

    if (enemy.hazardOnly) {
      // Spiky-shelled hazards hurt from any direction — only a thrown
      // stone (or invincibility/dash, handled above) clears them.
      this.loseLife();
      return;
    }

    const playerFalling = player.body.velocity.y > 0;
    const landedOnTop = player.body.bottom - enemy.body.top < 14;

    if (playerFalling && landedOnTop) {
      enemy.destroy();
      player.setVelocityY(JUMP_VELOCITY * 0.55);
      sfx.stomp();
      this.registerKill(enemy.points ?? 20, x, y);
    } else {
      this.loseLife();
    }
  }

  damageBoss() {
    if (!this.boss || this.bossDefeated) return;
    this.boss.hitsRemaining -= 1;
    sfx.stomp();
    this.score += 30;
    this.scoreText.setText(`Score: ${this.score}`);
    const hitsLeft = Math.max(this.boss.hitsRemaining, 0);
    this.bossHealthBar.width = (200 * hitsLeft) / 3;
    this.bossHealthLabel.setText(`${hitsLeft} / 3 HP`);
    this.boss.setTint(0xffffff);
    vibrate(40);
    this.cameras.main.shake(150, 0.006);
    this.time.delayedCall(100, () => this.boss?.clearTint());

    if (this.boss.hitsRemaining <= 0) {
      this.bossDefeated = true;
      this.bossGrowlEvent?.remove();
      vibrate([80, 60, 120]);
      this.cameras.main.shake(400, 0.015);
      this.boss.destroy();
      this.boss = null;
      this.bossHealthBar.destroy();
      this.bossHealthBg.destroy();
      this.bossHealthLabel.destroy();
    }
  }

  hitBossWithStone(stone, boss) {
    stone.destroy();
    this.damageBoss();
  }

  hitBoss(player, boss) {
    if (this.gameOver || this.bossDefeated) return;
    const playerFalling = player.body.velocity.y > 0;
    const landedOnTop = player.body.bottom - boss.body.top < 16;

    if (this.invincible || this.isDashing || (playerFalling && landedOnTop)) {
      this.damageBoss();
      if (!this.bossDefeated) player.setVelocityY(JUMP_VELOCITY * 0.55);
    } else {
      this.loseLife();
    }
  }

  loseLife() {
    if (this.gameOver) return;

    if (this.hasShield) {
      this.hasShield = false;
      this.shieldAura.setVisible(false);
      sfx.hurt();
      vibrate(60);
      this.cameras.main.shake(150, 0.006);
      this.player.setPosition(this.checkpointX, GROUND_Y - 60);
      this.player.setVelocity(0, 0);
      return;
    }

    sfx.hurt();
    vibrate(120);
    this.cameras.main.shake(250, 0.01);
    this.lives -= 1;
    this.updateHearts();
    if (this.lives <= 0) {
      this.endGame("💀 Game Over");
      return;
    }
    this.player.setPosition(this.checkpointX, GROUND_Y - 60);
    this.player.setVelocity(0, 0);
  }

  winLevel() {
    if (this.gameOver) return;
    if (this.hasBoss && !this.bossDefeated) return;

    unlockLevel(this.levelIndex + 1);

    const replayThisLevel = () =>
      this.scene.restart({ levelIndex: this.levelIndex, score: this.scoreAtLevelStart, lives: MAX_LIVES, checkpointX: 80 });

    sfx.levelUp();
    this.showEndScreen(
      `Level ${this.levelIndex + 1} complete!\n🪙 Coins: ${this.coinsCollected}/${this.totalCoins}`,
      [
        {
          label: "▶  Next level",
          onClick: () =>
            this.scene.restart({ levelIndex: this.levelIndex + 1, score: this.score, lives: this.lives, checkpointX: 80 }),
        },
        { label: "🔄  Replay this level", onClick: replayThisLevel },
      ],
      { celebrate: true },
    );
  }

  endGame(text) {
    this.player.setTint(0xff6666);
    this.showEndScreen(text, [
      {
        label: "🔄 Retry from checkpoint",
        onClick: () =>
          this.scene.restart({
            levelIndex: this.levelIndex,
            score: this.scoreAtLevelStart,
            lives: MAX_LIVES,
            checkpointX: this.checkpointX,
            bossDefeated: this.bossDefeated,
          }),
      },
      {
        label: "⏮ Restart from Level 1",
        onClick: () => this.scene.restart({ levelIndex: 0, score: 0, lives: MAX_LIVES, checkpointX: 80 }),
      },
    ], { celebrate: false, accent: "#b91c1c" });
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.keys.P) && !this.gameOver) {
      this.togglePause();
    }
    if (this.gameOver || this.isPaused) return;

    if (this.invincible && this.time.now > this.invincibleUntil) {
      this.endInvincibility();
    }

    const speed = 220;
    const onGround = this.player.body.blocked.down || this.player.body.touching.down;
    if (onGround && !this.wasOnGround) this.playLandSquash();
    if (onGround) this.jumpsUsed = 0;
    this.wasOnGround = onGround;

    const left = this.cursors.left.isDown || this.keys.A.isDown || touchState.left;
    const right = this.cursors.right.isDown || this.keys.D.isDown || touchState.right;
    if (left) this.facing = -1;
    else if (right) this.facing = 1;

    if (this.isDashing) {
      this.player.setFlipX(this.facing < 0);
    } else if (left) {
      this.player.setVelocityX(-speed);
      this.player.setFlipX(true);
    } else if (right) {
      this.player.setVelocityX(speed);
      this.player.setFlipX(false);
    } else {
      this.player.setVelocityX(0);
    }

    const dashPressed = Phaser.Input.Keyboard.JustDown(this.keys.SHIFT) || touchState.dashPressed;
    touchState.dashPressed = false;
    if (dashPressed && this.canDash && !this.isDashing) {
      this.isDashing = true;
      this.canDash = false;
      this.player.setVelocityX(650 * this.facing);
      this.player.setVelocityY(0);
      sfx.dash();
      this.cameras.main.shake(80, 0.003);
      this.time.delayedCall(180, () => (this.isDashing = false));
      this.time.delayedCall(700, () => (this.canDash = true));
    }

    this.dustEmitter.setPosition(this.player.x, this.player.y + 18);
    if (onGround && (left || right)) this.dustEmitter.start();
    else this.dustEmitter.stop();

    this.shieldAura.setPosition(this.player.x, this.player.y);

    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.W) ||
      touchState.jumpPressed;
    touchState.jumpPressed = false;

    if (jumpPressed && this.jumpsUsed < MAX_JUMPS) {
      this.player.setVelocityY(this.jumpsUsed === 0 ? JUMP_VELOCITY : JUMP_VELOCITY * 0.85);
      this.jumpsUsed += 1;
      this.playJumpSquash();
      sfx.jump();
    }

    const jumpHeld = this.cursors.up.isDown || this.keys.W.isDown || touchState.jumpHeld;
    if (!jumpHeld && this.player.body.velocity.y < -150) {
      this.player.setVelocityY(-150);
    }

    const throwPressed =
      Phaser.Input.Keyboard.JustDown(this.keys.SPACE) ||
      Phaser.Input.Keyboard.JustDown(this.keys.F) ||
      touchState.throwPressed;
    touchState.throwPressed = false;
    if (throwPressed) this.throwStone();

    if (this.player.y > WORLD_HEIGHT + 100) {
      this.loseLife();
    }

    const CHASE_RANGE = 240;
    this.enemies.getChildren().forEach((enemy) => {
      const dx = this.player.x - enemy.x;
      const sameLevel = Math.abs(this.player.y - enemy.y) < 70;
      if (enemy.chases && sameLevel && Math.abs(dx) < CHASE_RANGE) {
        // Close enough to notice the player — rush toward them instead of
        // just patrolling, but never past the patrol fence either side.
        const chaseSpeed = enemy.speed * 1.6;
        const withinFence = enemy.x > enemy.patrolFrom - 40 && enemy.x < enemy.patrolTo + 40;
        if (withinFence) {
          enemy.setVelocityX(dx > 0 ? chaseSpeed : -chaseSpeed);
        } else {
          enemy.setVelocityX(enemy.x < enemy.patrolFrom ? enemy.speed : -enemy.speed);
        }
      } else {
        if (enemy.x <= enemy.patrolFrom) enemy.setVelocityX(enemy.speed);
        if (enemy.x >= enemy.patrolTo) enemy.setVelocityX(-enemy.speed);
      }
    });

    this.flyers.getChildren().forEach((flyer) => {
      if (flyer.x <= flyer.patrolFrom) flyer.setVelocityX(flyer.speed);
      if (flyer.x >= flyer.patrolTo) flyer.setVelocityX(-flyer.speed);
      flyer.y = flyer.baseY + Math.sin(this.time.now / flyer.bobSpeed + flyer.phase) * flyer.bobAmp;
      flyer.body.updateFromGameObject();
    });

    this.movingPlatforms.getChildren().forEach((mp) => {
      if (mp.y <= mp.minY) mp.setVelocityY(60);
      if (mp.y >= mp.maxY) mp.setVelocityY(-60);
    });

    if (this.boss && !this.bossDefeated) {
      if (this.boss.x <= this.boss.patrolFrom) this.boss.setVelocityX(this.boss.speed);
      if (this.boss.x >= this.boss.patrolTo) this.boss.setVelocityX(-this.boss.speed);
    }
  }
}

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: WORLD_HEIGHT,
  parent: "app",
  physics: {
    default: "arcade",
    arcade: { gravity: { y: 1000 }, debug: false },
  },
  scene: [MenuScene, MainScene],
};

new Phaser.Game(config);
