export const KATEGORI = ['Waiting List', 'Active', 'Active - Pesara', 'Off', 'Defaulted'];
export const UNITS = ['Medical', 'Psychiatry', 'O&G', 'Oncology', 'Surgical', 'Ophthalmology', 'Dermatology', 'Peadiatric'];
export const NEEDS_STOP_DATE = ['Off', 'Defaulted'];

const ALLOWED = {
  'Waiting List': ['Active', 'Active - Pesara', 'Off'],
  Active: ['Active - Pesara', 'Off', 'Defaulted'],
  'Active - Pesara': ['Active', 'Off', 'Defaulted'],
  Off: ['Waiting List', 'Active'],
  Defaulted: ['Waiting List', 'Active', 'Off'],
};

export const canMove = (from, to) => from === to || !!ALLOWED[from]?.includes(to);
export const nextStates = (from) => ALLOWED[from] || [];
