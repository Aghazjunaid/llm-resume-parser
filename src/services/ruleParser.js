// ============================================================================
// "WITHOUT LLM" parser - regex + keyword heuristics only.
//
// This is how resume parsing worked before LLMs. It is fast (a few ms), free and
// deterministic, but every rule below is a GUESS about how people format resumes.
// It does well on neat, conventional resumes and breaks on anything unusual.
// The comments point out where each rule can fail - compare with /api/parse/llm
// to see those failures for real.
// ============================================================================

const { extractUrls } = require('./urlExtractor');

// ---------------------------------------------------------------------------
// Section headings
// A line is a heading only if it EXACTLY matches one of these (ignoring case and
// a trailing colon). "Where I've Worked" or "My Journey" won't be recognised,
// and that whole section is lost.
// ---------------------------------------------------------------------------
const SECTION_HEADINGS = {
  summary: ['summary', 'professional summary', 'profile', 'professional profile', 'objective', 'career objective', 'about', 'about me'],
  experience: ['experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'career history'],
  education: ['education', 'academic background', 'academics', 'qualifications', 'educational qualifications'],
  skills: ['skills', 'technical skills', 'key skills', 'core skills', 'core competencies', 'technologies', 'tech stack', 'skills & tools', 'skills and tools'],
  certifications: ['certifications', 'certification', 'certificates', 'licenses & certifications', 'licenses and certifications'],
  projects: ['projects', 'personal projects', 'key projects', 'academic projects', 'selected projects'],
  languages: ['languages', 'spoken languages'],
  interests: ['interests', 'hobbies', 'hobbies & interests', 'hobbies and interests'],
};

const HEADING_LOOKUP = new Map();
for (const [section, names] of Object.entries(SECTION_HEADINGS)) {
  for (const name of names) HEADING_LOOKUP.set(name, section);
}

// ---------------------------------------------------------------------------
// Known skills dictionary
// Skills are only found if they are in this list. Anything else ("Snowflake",
// "Salesforce", "Figma plugins"...) is invisible unless it sits in the Skills
// section. An LLM needs no list - it knows what a skill is.
// ---------------------------------------------------------------------------
const KNOWN_SKILLS = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C', 'C++', 'C#', 'Go', 'Golang', 'Rust', 'Ruby', 'PHP',
  'Kotlin', 'Swift', 'Scala', 'R', 'Dart', 'SQL', 'Bash', 'Shell', 'HTML', 'CSS', 'SASS',
  'React', 'React.js', 'React Native', 'Next.js', 'Vue', 'Vue.js', 'Angular', 'Svelte', 'Redux',
  'Tailwind CSS', 'Tailwind', 'Bootstrap', 'jQuery', 'Flutter',
  'Node.js', 'Express', 'Express.js', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Spring',
  'Laravel', 'Ruby on Rails', 'Rails', '.NET', 'ASP.NET', 'GraphQL', 'REST', 'REST APIs', 'gRPC', 'Microservices',
  'MySQL', 'PostgreSQL', 'Postgres', 'MongoDB', 'Redis', 'SQLite', 'Oracle', 'SQL Server', 'DynamoDB',
  'Cassandra', 'Elasticsearch', 'Firebase', 'Supabase', 'Prisma', 'Sequelize', 'Mongoose',
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Terraform', 'Jenkins', 'GitHub Actions',
  'CI/CD', 'Linux', 'Nginx', 'Kafka', 'RabbitMQ', 'Git', 'Serverless', 'AWS Lambda', 'Lambda',
  'Pandas', 'NumPy', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'Machine Learning', 'Deep Learning', 'NLP',
  'LangChain', 'LLM', 'Spark', 'Hadoop', 'Airflow', 'Power BI', 'Tableau', 'Excel',
  'Jest', 'Mocha', 'Cypress', 'Selenium', 'Playwright', 'JUnit', 'Pytest',
  'Figma', 'Jira', 'Agile', 'Scrum', 'Postman', 'Webpack', 'Vite', 'Socket.io', 'WebSockets', 'OAuth', 'JWT',
];

// These are also ordinary English words ("go", "express", "spring"...), so they are
// matched case-sensitively. Still not perfect: "Go to market" at the start of a
// sentence counts as the Go language.
const CASE_SENSITIVE_SKILLS = new Set(['C', 'R', 'Go', 'Express', 'Spring', 'Swift', 'Rust', 'Dart', 'Shell', 'Lambda', 'Excel', 'Oracle', 'REST', 'Git', 'Agile']);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Longest first, so "React Native" is matched before "React" and "Spring Boot" before "Spring".
const SKILL_MATCHERS = [...KNOWN_SKILLS]
  .sort((a, b) => b.length - a.length)
  .map((skill) => ({
    skill,
    // Custom word boundaries: plain \b doesn't work for names like "C++" or ".NET".
    re: new RegExp(`(?<![A-Za-z0-9+#.])${escapeRegex(skill)}(?![A-Za-z0-9+#])`, CASE_SENSITIVE_SKILLS.has(skill) ? 'g' : 'gi'),
  }));

function findKnownSkills(text) {
  let remaining = text;
  const hits = [];
  for (const { skill, re } of SKILL_MATCHERS) {
    re.lastIndex = 0;
    const match = re.exec(remaining);
    if (!match) continue;
    hits.push({ skill, index: match.index });
    // Blank out every occurrence so shorter names ("React") don't match inside
    // longer ones already found ("React Native").
    remaining = remaining.replace(re, (m) => ' '.repeat(m.length));
  }
  return hits.sort((a, b) => a.index - b.index).map((h) => h.skill);
}

// ---------------------------------------------------------------------------
// Regexes for dates, contact details, degrees...
// ---------------------------------------------------------------------------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const DATE = String.raw`(?:${MONTH}\s*'?\d{2,4}|\d{1,2}[\/.-]\d{4}|(?:19|20)\d{2})`;
const END_WORDS = String.raw`Present|Current|Now|Till Date|Today|Ongoing`;
// "Jan 2020 - Present", "03/2019 – 05/2021", "2018 to 2020", "Mar '19 - Jun '21"
// Misses: "since 2020", "2 years", "Summer 2021", dates split across two lines...
const DATE_RANGE_RE = new RegExp(String.raw`(${DATE})\s*(?:-|–|—|to|till|until)\s*(${DATE}|${END_WORDS})`, 'i');
const YEAR_RE = /\b(?:19|20)\d{2}\b/;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{7,}\d/g;

// "San Francisco, CA", "Bengaluru, India", "Remote". Also wrongly matches "Acme, Inc".
const LOCATION_RE = /^(?:remote|hybrid|[A-Z][A-Za-z.]+(?:\s[A-Z][A-Za-z.]+)*,\s*[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)*)$/i;

// Words that suggest "this chunk is a job title, not a company name".
// A title like "Member of Technical Staff" contains none of them and becomes the company.
const ROLE_WORDS_RE = /\b(?:engineer|developer|programmer|manager|intern|analyst|lead|designer|consultant|architect|scientist|specialist|director|officer|associate|administrator|head|executive|coordinator|founder|co-founder|cto|ceo|sde|trainee|tester|qa|devops)\b/i;

// Dotted forms are required for short degrees (B.E., M.A.) so words like "be" don't match.
const DEGREE_RE = /(?<![A-Za-z])(?:B\.?\s?Tech|M\.?\s?Tech|B\.E\.?|M\.E\.?|B\.?\s?Sc|M\.?\s?Sc|B\.?\s?Com|M\.?\s?Com|B\.A\.?|M\.A\.?|BCA|MCA|BBA|MBA|Ph\.?\s?D|Bachelor(?:'s)?|Master(?:'s)?|Doctorate|Diploma|Associate(?:'s)? Degree|High School|Higher Secondary|Senior Secondary|Secondary School|HSC|SSC|Class\s+(?:X|XII|10|12)(?:th)?|(?:10|12)th)(?![A-Za-z])/i;
const INSTITUTION_RE = /\b(?:University|College|Institute|School|Academy|Polytechnic|IIT|NIT|IIIT|BITS|Vidyalaya)\b/i;
const GRADE_RE = /\b(?:CGPA|GPA|Percentage|Grade|Score)\b\s*[:\-]?\s*([\d.]+\s*(?:\/\s*[\d.]+|%)?)|\b(\d{2}(?:\.\d+)?\s*%)/i;

// Bullet characters, including the private-use glyphs Word uses when exporting to PDF.
const BULLET_RE = /^[•●▪◦‣∙·*\-–]\s*/;

// pdf-parse turns clickable links into markdown: [LinkedIn](https://linkedin.com/in/x)
const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const isBullet = (line) => BULLET_RE.test(line);
const cleanBullet = (line) => line.replace(BULLET_RE, '').trim();

// Split a line on common separators: "Engineer | Acme Corp — Pune" -> 3 chunks.
// Commas are NOT split on by default ("Pune, India" should stay together).
function splitChunks(text, { commas = false } = {}) {
  const separators = commas ? /\s*[|•·●,]\s*|\s+[–—-]\s+|\s{2,}/ : /\s*[|•·●]\s*|\s+[–—-]\s+|\s{2,}/;
  return text
    .split(separators)
    .map((chunk) => chunk.replace(/^[\s(,]+|[\s),]+$/g, ''))
    .filter((chunk) => chunk && /[A-Za-z0-9]/.test(chunk));
}

// "Jan 2020" -> "2020-01", "03/2020" -> "2020-03", "Mar '19" -> "2019-03", "Present" -> "Present"
function normalizeDate(raw) {
  if (!raw) return null;
  const value = raw.trim();
  if (new RegExp(`^(?:${END_WORDS})$`, 'i').test(value)) return 'Present';

  const monthYear = value.match(/^([A-Za-z]+)\.?\s*'?(\d{2,4})$/);
  if (monthYear) {
    const month = MONTHS.indexOf(monthYear[1].slice(0, 3).toLowerCase()) + 1;
    const year = monthYear[2].length === 2 ? `20${monthYear[2]}` : monthYear[2];
    return month ? `${year}-${String(month).padStart(2, '0')}` : year;
  }
  const numeric = value.match(/^(\d{1,2})[\/.-](\d{4})$/);
  if (numeric) return `${numeric[2]}-${numeric[1].padStart(2, '0')}`;
  return value;
}

function stripDates(text) {
  return text.replace(DATE_RANGE_RE, '').replace(new RegExp(YEAR_RE.source, 'g'), '').replace(/\s{2,}/g, ' ').replace(/[\s,|–—-]+$/, '').trim();
}

function splitList(lines) {
  return lines
    .map(cleanBullet)
    .flatMap((line) => line.split(/\s*[,;|•·●]\s*/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueCaseInsensitive(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Step 1: split the document into sections by heading
// ---------------------------------------------------------------------------
function headingOf(line) {
  if (line.length > 40) return null;
  const key = line.toLowerCase().replace(/[:\s]+$/, '').replace(/\s+/g, ' ').trim();
  return HEADING_LOOKUP.get(key) || null;
}

// A short ALL-CAPS line ("OUTSIDE WORK") is probably a heading we don't know.
// Without this, its content would leak into the previous section.
const looksLikeUnknownHeading = (line) => /^[A-Z][A-Z &/-]{2,30}$/.test(line) && line.split(/\s+/).length <= 4;

function splitSections(lines) {
  // Everything before the first heading is the "header" (name, contact info).
  const sections = { header: [] };
  let current = 'header';
  for (const line of lines) {
    const section = headingOf(line) || (current !== 'header' && looksLikeUnknownHeading(line) ? 'unknown' : null);
    if (section) {
      current = section;
      sections[current] = sections[current] || [];
    } else {
      sections[current].push(line);
    }
  }
  return sections;
}

// Lines before the first section heading (name + contact details). Capped so a
// resume with no recognisable headings doesn't count as "all header".
// Also used by llmParser.js to check the LLM's answer.
function getHeaderText(rawText, maxLines = 15) {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  return splitSections(lines).header.slice(0, maxLines).join('\n');
}

// ---------------------------------------------------------------------------
// Step 2: one function per section
// ---------------------------------------------------------------------------
function parseContact(headerLines, text, urls) {
  const headerText = headerLines.join('\n');

  // Phone: any run of digits/spaces/dashes with 10-15 digits. Header first, so we
  // don't grab some random number from the middle of the resume.
  const findPhone = (source) =>
    [...source.matchAll(PHONE_CANDIDATE_RE)]
      .map((m) => m[0].trim())
      .find((candidate) => {
        const digits = candidate.replace(/\D/g, '').length;
        return digits >= 10 && digits <= 15 && !DATE_RANGE_RE.test(candidate);
      }) || null;

  // Name: the first short line near the top made only of 2-4 words.
  // Fails when the resume starts with a job title ("Senior Software Engineer")
  // or the name is written as "SMITH, Jane" or in a single word.
  const nameLine = headerLines.slice(0, 5).find((line) => /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,3}$/.test(line) && !ROLE_WORDS_RE.test(line));

  const headerChunks = headerLines.flatMap((line) => splitChunks(line));
  const location = headerChunks.find((chunk) => LOCATION_RE.test(chunk) && !EMAIL_RE.test(chunk) && !/\d{5,}/.test(chunk)) || null;

  // URLs: we can only sort them by domain. A personal site vs a blog vs a
  // portfolio all look the same to a regex.
  const linkedin = urls.find((u) => /linkedin\.com/i.test(u)) || null;
  const github = urls.find((u) => /github\.com\/[^/\s]+\/?$/i.test(u)) || null; // profile, not a repo
  const website = urls.find((u) => u !== linkedin && u !== github && headerText.includes(u)) || null;

  return {
    name: nameLine || null,
    email: text.match(EMAIL_RE)?.[0] || null,
    phone: findPhone(headerText) || findPhone(text),
    location,
    linkedin,
    github,
    website,
    other_links: urls.filter((u) => ![linkedin, github, website].includes(u)),
  };
}

function guessRoleCompanyLocation(parts) {
  const result = { company: null, role: null, location: null };
  const rest = [];
  for (const part of parts) {
    const at = part.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i); // "Engineer at Acme"
    if (at && !result.role) {
      result.role = at[1];
      result.company = at[2];
    } else if (!result.location && LOCATION_RE.test(part)) {
      result.location = part;
    } else if (!result.role && ROLE_WORDS_RE.test(part)) {
      result.role = part;
    } else {
      rest.push(part);
    }
  }
  // Whatever is left over, we ASSUME is the company.
  if (!result.company && rest.length) result.company = rest[0];
  return result;
}

// Header lines ("Razorpay — Software Engineer II") are short and don't end like a sentence.
const looksLikeHeaderLine = (line) => line.length <= 70 && !/[.!]$/.test(line);

// Every job must have a date range on some line - that's how we know a new job
// starts. A job written as "Acme Corp (2 years)" or "since 2019" is invisible to
// this parser and gets glued onto the previous job.
function parseExperience(lines) {
  const jobs = [];
  let job = null;
  let preamble = []; // plain lines before the first date range
  let plainTail = 0; // how many of the current job's last responsibilities were plain (non-bullet) lines

  for (const line of lines) {
    const range = line.match(DATE_RANGE_RE);

    if (range) {
      // The company/role usually sits on the line(s) just ABOVE the dates. For the
      // first job that's the preamble; for later jobs those lines were already filed
      // as the previous job's responsibilities, so take the header-like ones back.
      let headerLines = preamble.slice(-2);
      if (job) {
        const resp = job.responsibilities;
        let take = 0;
        while (take < Math.min(plainTail, 2) && looksLikeHeaderLine(resp[resp.length - 1 - take])) take++;
        headerLines = take ? resp.splice(-take, take) : [];
      }
      const parts = [...headerLines, line.replace(range[0], '')].flatMap((l) => splitChunks(l));
      job = {
        ...guessRoleCompanyLocation(parts),
        start_date: normalizeDate(range[1]),
        end_date: normalizeDate(range[2]),
        responsibilities: [],
        technologies: [],
      };
      jobs.push(job);
      preamble = [];
      plainTail = 0;
      continue;
    }

    if (!job) {
      preamble.push(line);
      continue;
    }
    if (isBullet(line)) {
      job.responsibilities.push(cleanBullet(line));
      plainTail = 0;
      continue;
    }
    // A plain line right after the date line that looks like a title: "Acme Corp  2020-2022" then "Backend Developer"
    if (!job.role && job.responsibilities.length === 0 && ROLE_WORDS_RE.test(line) && line.length < 60) {
      job.role = line;
      continue;
    }
    // Starts lowercase -> probably the wrapped second line of the previous bullet.
    if (/^[a-z]/.test(line) && job.responsibilities.length) {
      job.responsibilities[job.responsibilities.length - 1] += ` ${line}`;
      continue;
    }
    // Otherwise we can't tell yet: a responsibility, or the next job's header?
    // Keep it as a responsibility; the next date line may take it back.
    job.responsibilities.push(line);
    plainTail++;
  }

  for (const j of jobs) {
    j.technologies = findKnownSkills([j.role, j.company, ...j.responsibilities].join('\n'));
  }
  return jobs;
}

function splitDegree(text) {
  const inMatch = text.match(/^(.+?)\s+in\s+(.+)$/i); // "Master of Science in Data Science"
  if (inMatch) return { degree: inMatch[1], field: inMatch[2] };
  const parens = text.match(/^(.+?)\s*\((.+)\)$/); // "B.Tech (Computer Science)"
  if (parens) return { degree: parens[1], field: parens[2] };
  return { degree: text, field: null };
}

function parseEducation(lines) {
  const entries = [];
  let entry = null;
  const newEntry = () => {
    entry = { institution: null, degree: null, field_of_study: null, start_date: null, end_date: null, grade: null };
    entries.push(entry);
  };

  for (const raw of lines) {
    const line = cleanBullet(raw);
    const withoutGrade = line.replace(GRADE_RE, '');

    for (const part of splitChunks(stripDates(withoutGrade), { commas: true })) {
      if (DEGREE_RE.test(part)) {
        if (!entry || entry.degree) newEntry();
        const { degree, field } = splitDegree(part);
        entry.degree = degree;
        entry.field_of_study = field;
      } else if (INSTITUTION_RE.test(part)) {
        if (!entry || entry.institution) newEntry();
        entry.institution = part;
      }
      // Anything else (a city, a line about "Dean's list"...) is dropped.
    }

    if (!entry) continue;
    const range = line.match(DATE_RANGE_RE);
    if (range) {
      entry.start_date = normalizeDate(range[1]);
      entry.end_date = normalizeDate(range[2]);
    } else if (!entry.end_date && YEAR_RE.test(line)) {
      entry.end_date = line.match(YEAR_RE)[0];
    }
    const grade = line.match(GRADE_RE);
    if (grade && !entry.grade) entry.grade = (grade[1] || grade[2]).trim();
  }
  return entries;
}

function parseCertifications(lines) {
  return lines.map(cleanBullet).map((line) => {
    const year = line.match(YEAR_RE)?.[0] || null;
    const by = line.match(/^(.+?)\s+(?:by|from)\s+(.+)$/i);
    const [name, issuer] = by ? [by[1], by[2]] : splitChunks(stripDates(line));
    return { name: stripDates(name || line), issuer: issuer ? stripDates(issuer) : null, year };
  });
}

// Guess: a short line without a bullet is a project title; everything after it is
// its description. A project written as one long sentence won't be split correctly.
function parseProjects(lines) {
  const projects = [];
  let project = null;

  for (const raw of lines) {
    const bullet = isBullet(raw);
    const line = cleanBullet(raw);
    const url = extractUrls(line)[0] || null;

    // A line that is only a link belongs to the project above it.
    if (project && url && line === url) {
      project.url = project.url || url;
      continue;
    }
    const looksLikeTitle = !bullet && line.length <= 80 && !/\.$/.test(line);

    if (looksLikeTitle || !project) {
      const [name] = splitChunks(line.replace(DATE_RANGE_RE, ''));
      project = { name: name || null, description: null, url, technologies: [], _text: line };
      projects.push(project);
      if (looksLikeTitle) continue;
    }
    project.description = project.description ? `${project.description} ${line}` : line;
    project._text += `\n${line}`;
    if (!project.url && url) project.url = url;
  }

  return projects.map(({ _text, ...p }) => ({ ...p, technologies: findKnownSkills(_text) }));
}

function parseLanguages(lines) {
  return splitList(lines).map((item) => {
    const m = item.match(/^(.+?)\s*[(:\-–]\s*([^)]+)\)?$/); // "English (Native)", "Hindi - Fluent"
    return m ? { language: m[1].trim(), proficiency: m[2].trim() } : { language: item, proficiency: null };
  });
}

function parseSkills(skillLines, fullText) {
  // 1. Items from the Skills section: split on commas/bullets and drop "Label:" prefixes
  //    ("Languages: Python, Go" -> Python, Go).
  const listed = skillLines
    .map((line) => cleanBullet(line).replace(/^[^:]{1,30}:\s*/, ''))
    .flatMap((line) => line.split(/\s*[,;|•·●]\s*|\s\/\s/))
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 40);

  // 2. Plus every dictionary skill found anywhere in the document.
  return uniqueCaseInsensitive([...listed, ...findKnownSkills(fullText)]);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function parseWithRules(rawText) {
  // Find URLs on the raw text (it still has the markdown link targets), then flatten
  // "[LinkedIn](https://...)" to "LinkedIn https://..." for the line-based rules.
  const urls = extractUrls(rawText);
  const text = rawText.replace(MD_LINK_RE, (_, label, href) => (label && label !== href ? `${label} ${href}` : href));

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const sections = splitSections(lines);
  const get = (name) => sections[name] || [];

  const data = {
    contact: parseContact(get('header'), text, urls),
    summary: get('summary').join(' ') || null,
    work_experience: parseExperience(get('experience')),
    education: parseEducation(get('education')),
    skills: parseSkills(get('skills'), text),
    certifications: parseCertifications(get('certifications')),
    projects: parseProjects(get('projects')),
    languages: parseLanguages(get('languages')),
    interests: splitList(get('interests')),
  };

  return {
    data,
    meta: {
      sections_found: Object.keys(sections).filter((s) => s !== 'header'),
      urls_found: urls.length,
    },
  };
}

module.exports = { parseWithRules, getHeaderText };
