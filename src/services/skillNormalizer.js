// Removes duplicate skills that are the same thing spelled differently:
//
//   case            "Typescript"  / "TypeScript"
//   punctuation     "CI/CD"       / "CICD",  "Socket.io" / "SocketIO"
//   ".js" suffix    "Next"        / "Next.js" / "NextJS"
//   aliases         "Postgres"    / "PostgreSQL",  "K8s" / "Kubernetes",  "MS SQL" / "SQL Server"
//   versions        "HTML5"       / "HTML",  "Python3" / "Python"
//
// Plain code, so it's deterministic - the prompt asks the LLM not to repeat skills,
// this makes sure. Related-but-different skills are deliberately NOT merged:
// "SQL" (the language) vs "MS SQL Server" (a database), "AWS" vs "AWS S3",
// "Django" vs "Django-admin".

// Official name -> other spellings. Add more as you see them in real resumes.
// (Case, spaces, dots, dashes and a trailing "js" are already ignored, so
// "Node.js", "NodeJS" and "node js" don't need listing.)
const ALIASES = {
  'JavaScript': ['JS', 'ECMAScript', 'ES6'],
  'TypeScript': ['TS'],
  'Node.js': ['Node'],
  'Next.js': ['Next'],
  'React': ['React.js'],
  'Vue.js': ['Vue'],
  'Express': ['Express.js'],
  'NestJS': ['Nest'],
  'PostgreSQL': ['Postgres', 'Postgre', 'PSQL'],
  'MongoDB': ['Mongo'],
  'MS SQL Server': ['MSSQL', 'MS SQL', 'SQL Server', 'Microsoft SQL Server'],
  'Kubernetes': ['K8s'],
  'Go': ['Golang'],
  'Python': ['Python3', 'Python 3'],
  'HTML': ['HTML5'],
  'CSS': ['CSS3'],
  'AWS': ['Amazon Web Services'],
  'AWS S3': ['S3', 'Amazon S3'],
  'GCP': ['Google Cloud', 'Google Cloud Platform'],
  'Azure': ['Microsoft Azure'],
  '.NET': ['dotnet'],
  'CI/CD': ['CICD'],
  'REST APIs': ['REST', 'REST API', 'RESTful', 'RESTful APIs', 'RESTful API'],
  'Tailwind CSS': ['Tailwind'],
  'Ant Design': ['AntD'],
  'Material UI': ['MUI'],
  'Elasticsearch': ['Elastic Search'],
  'Scikit-learn': ['sklearn'],
  'Machine Learning': ['ML'],
};

// "Next.js" -> "next", "CI/CD" -> "cicd", "C++" -> "c++" (+ and # are kept)
function baseKey(name) {
  const key = name.toLowerCase().replace(/[\s._\-\/]+/g, '');
  return key.replace(/js$/, '') || key; // "nextjs" -> "next", but "js" alone stays "js"
}

const ALIAS_TO_KEY = new Map();
const OFFICIAL_NAME = new Map();
for (const [official, aliases] of Object.entries(ALIASES)) {
  const key = baseKey(official);
  OFFICIAL_NAME.set(key, official);
  for (const alias of aliases) ALIAS_TO_KEY.set(baseKey(alias), key);
}

const skillKey = (name) => {
  const key = baseKey(name);
  return ALIAS_TO_KEY.get(key) || key;
};

// Returns the de-duplicated list (first-seen order) and the groups that were merged.
function dedupeSkills(items) {
  const groups = new Map(); // key -> every spelling seen
  for (const raw of items) {
    const name = raw.trim();
    if (!name) continue;
    const key = skillKey(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }

  const list = [];
  const merged = [];
  for (const [key, names] of groups) {
    // Official name if we know it, otherwise the longest spelling ("Sails.js" over "Sails").
    const kept = OFFICIAL_NAME.get(key) || names.reduce((a, b) => (b.length > a.length ? b : a));
    list.push(kept);
    if (names.length > 1) merged.push({ names, kept });
  }
  return { list, merged };
}

// Cleans skills and every technologies list in place; returns what changed.
function normalizeResumeSkills(data) {
  const corrections = [];
  const clean = (label, items) => {
    const { list, merged } = dedupeSkills(items);
    for (const { names, kept } of merged) {
      corrections.push(`${label}: merged ${names.map((n) => `"${n}"`).join(' + ')} into "${kept}"`);
    }
    return list;
  };

  data.skills = clean('skills', data.skills);
  data.work_experience.forEach((job, i) => {
    job.technologies = clean(`work_experience[${i}].technologies`, job.technologies);
  });
  data.projects.forEach((project, i) => {
    project.technologies = clean(`projects[${i}].technologies`, project.technologies);
  });
  return corrections;
}

module.exports = { normalizeResumeSkills, dedupeSkills };
