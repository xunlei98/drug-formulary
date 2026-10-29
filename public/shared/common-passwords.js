export const COMMON = new Set(`password password1 password12 password123 passw0rd p@ssw0rd p@ssword123 qwerty qwerty123 qwertyuiop
123456 1234567 12345678 123456789 1234567890 0123456789 1q2w3e4r 1qaz2wsx abc123 abcd1234 iloveyou letmein welcome welcome1 welcome123
admin admin123 admin1234 administrator changeme changeme123 monkey dragon football baseball master login hospital hospital123
limbang limbang123 farmasi farmasi123 pharmacy pharmacy123 ubatmahal sarawak sarawak123 malaysia malaysia123 kkm kkm1234 moh12345
111111 000000 123123 654321 987654321 zaq12wsx trustno1 sunshine princess starwars`.split(/\s+/).filter(Boolean));

// Returns why a password is not acceptable, or null.
export function passwordProblem(pw, username = '') {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || new Set(low).size < 4) return 'That password is too common. Pick another.';
  if (username && low.includes(username.toLowerCase())) return 'Password must not contain the username';
  return null;
}
