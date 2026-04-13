import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
      title: z.string(),
      titleEn: z.string().default(''),
      slug: z.string(),
      year: z.number().min(2018).max(2030),
      organization: z.string(),
      organizationEn: z.string().default(''),
      sector: z.enum([
        'museum',
        'performing-arts',
        'public',
        'commercial',
        'artist',
        'self-initiated',
      ]),
      type: z
        .array(
          z.enum(['exhibition', 'editorial', 'identity', 'space', 'branding'])
        )
        .min(1),
      thumbnail: z.string().optional(),
      heroImage: z.string().optional(),
      heroLayout: z
        .enum(['full-bleed', 'content-width'])
        .default('content-width'),
      sortOrder: z.number().default(50),
      collaboration: z.enum(['solo', 'collaboration']).default('solo'),
      collaborator: z.string().optional(),
      description: z.string().optional(),
      descriptionEn: z.string().optional(),
      deliverables: z
        .array(
          z.object({
            item: z.string(),
            itemEn: z.string().optional(),
            spec: z.string().optional(),
          })
        )
        .optional(),
      credits: z
        .object({
          design: z.string().default('studionin'),
          photography: z.string().optional(),
          client: z.string().optional(),
          other: z
            .array(z.object({ role: z.string(), name: z.string() }))
            .optional(),
        })
        .optional(),
      featured: z.boolean().default(true),
      draft: z.boolean().default(false),
    }),
});

export const collections = { projects };
