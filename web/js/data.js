// Static data: factory preset banks (from Teenage Engineering's "Default preset banks" chart),
// effect definitions and punch-in FX names. No audio or DOM code here.

// Rows run top to bottom as printed on the chart; three pads per row.
const rows = (...r) => r.flat();

// PRESETS[project][group] = 12 sample numbers in on-screen pad order (top-left first).
export const PRESETS = {
  1: {
    A: rows([343, 235, 247], [317, 200, 218], [100, 114, 130], [1, 21, 300]),
    B: rows([445, 450, 455], [430, 435, 440], [415, 420, 425], [400, 405, 410]),
    C: rows([545, 550, 555], [530, 353, 540], [515, 520, 525], [500, 505, 510]),
  },
  2: {
    A: rows([346, 237, 248], [320, 203, 221], [103, 117, 133], [7, 24, 303]),
    B: rows([446, 451, 456], [431, 436, 441], [416, 421, 426], [401, 406, 411]),
    C: rows([546, 551, 556], [531, 536, 541], [516, 521, 526], [501, 506, 511]),
  },
  3: {
    A: rows([350, 239, 249], [333, 208, 224], [106, 121, 136], [11, 26, 306]),
    B: rows([447, 452, 457], [432, 437, 442], [417, 422, 427], [402, 407, 412]),
    C: rows([547, 552, 557], [532, 537, 542], [517, 522, 527], [502, 507, 512]),
  },
  4: {
    A: rows([352, 242, 251], [337, 212, 228], [109, 125, 140], [16, 30, 310]),
    B: rows([448, 453, 458], [433, 438, 443], [418, 423, 428], [403, 408, 413]),
    C: rows([548, 553, 558], [533, 538, 543], [518, 523, 528], [503, 508, 513]),
  },
};

export const GROUPS = ['A', 'B', 'C', 'D'];
export const PROJECT_COUNT = 9;
export const PPQ = 96;               // ticks per quarter note
export const BAR_TICKS = PPQ * 4;    // 4/4 only
export const MAX_BARS = 99;
export const STEP_PAGE_BARS = 4;       // bars shown at once in the step grid
export const PATTERNS_PER_GROUP = 99;
export const USER_SAMPLE_MIN = 600;  // ids 1-599 are factory; 600-999 are user slots
export const USER_SAMPLE_MAX = 999;

// Labels as printed on the hardware pads, in on-screen order.
export const PAD_LABELS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'ENT'];

export const GRIDS = {
  '1/4': 96, '1/8': 48, '1/8T': 32, '1/16': 24, '1/16T': 16, '1/32': 12,
};

// Keys-mode scales as semitone steps from the root. The pad grid walks up these degrees.
export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Effect X/Y labels follow the EP-133 guide. Defaults are the knob resting positions.
export const EFFECTS = {
  delay:      { label: 'DELAY',      x: 'LENGTH',     y: 'FEEDBACK',  def: [0.5, 0.4] },
  reverb:     { label: 'REVERB',     x: 'LENGTH',     y: 'COLOUR',    def: [0.5, 0.5] },
  distortion: { label: 'DISTORTION', x: 'DRIVE',      y: 'COLOUR',    def: [0.4, 0.6] },
  chorus:     { label: 'CHORUS',     x: 'MODULATION', y: 'FEEDBACK',  def: [0.4, 0.5] },
  filter:     { label: 'FILTER',     x: 'CUTOFF',     y: 'RESONANCE', def: [0.5, 0.2] },
  compressor: { label: 'COMPRESSOR', x: 'DRIVE',      y: 'SPEED',     def: [0.4, 0.5] },
};

export const PUNCH_FX = [
  'LP SWEEP', 'HP SWEEP', 'DELAY THROW', 'VERB THROW',
  'DISTORT', 'FLANGE', 'STUTTER 1/8', 'STUTTER 1/16',
  'BITCRUSH', 'TAPE STOP', 'PITCH DOWN', 'PITCH UP',
];
