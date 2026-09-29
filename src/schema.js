// The shape of a parsed resume. BOTH parsers (rules and LLM) return exactly this
// shape, so you can put the two responses side by side and compare field by field.
//
// The same zod schema is used for two jobs:
//   1. Converted to JSON Schema and sent to Gemini, so the model knows what to return.
//   2. Validating whatever Gemini sends back (never trust LLM output blindly).
// The .describe() text ends up inside the JSON Schema, so it doubles as instructions
// for the LLM.

const { z } = require('zod');

const str = z.string().nullable();
const list = z.array(z.string());

const ContactSchema = z.object({
  name: str,
  email: str,
  phone: str,
  location: str.describe(
    "The person's location ONLY if written in the contact details at the top of the resume. " +
      'null if not there. Never copy it from a job or education entry.'
  ),
  linkedin: str,
  github: str,
  website: str.describe('Personal website or portfolio'),
  other_links: list.describe('Any other URL not assigned to a field above'),
});

const WorkExperienceSchema = z.object({
  company: str,
  role: str,
  location: str,
  start_date: str.describe('YYYY-MM if the month is known, else YYYY'),
  end_date: str.describe('YYYY-MM, YYYY, or "Present"'),
  responsibilities: list,
  technologies: list,
});

const EducationSchema = z.object({
  institution: str,
  degree: str,
  field_of_study: str,
  start_date: str,
  end_date: str,
  grade: str.describe('GPA / CGPA / percentage, exactly as written'),
});

const CertificationSchema = z.object({
  name: str,
  issuer: str,
  year: str,
});

const ProjectSchema = z.object({
  name: str,
  description: str,
  url: str,
  technologies: list,
});

const LanguageSchema = z.object({
  language: str,
  proficiency: str,
});

const ResumeSchema = z.object({
  contact: ContactSchema,
  summary: str,
  work_experience: z.array(WorkExperienceSchema),
  education: z.array(EducationSchema),
  skills: list.describe('Every skill mentioned anywhere in the resume, one per element'),
  certifications: z.array(CertificationSchema),
  projects: z.array(ProjectSchema),
  languages: z.array(LanguageSchema).describe('Spoken languages, not programming languages'),
  interests: list,
});

// JSON Schema version for the LLM. "$schema" is just metadata, so drop it.
const { $schema, ...resumeJsonSchema } = z.toJSONSchema(ResumeSchema);

module.exports = { ResumeSchema, resumeJsonSchema };
