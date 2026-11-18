import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins: PluginOption[] = [react(), tailwindcss(), {
    name: 'atlas-offline-runtime',
    transformIndexHtml: {
      order: 'post' as const,
      // Hosting/editor tooling may inject these recorders into index.html.
      // Exclude only those external-network scripts from this offline UI.
      handler: (html: string) => html.replace(/<script\b[^>]*\bdata-arena-(?:recording|views)\b[^>]*>[\s\S]*?<\/script>/gi, ''),
    },
  }];
  try {
    // @ts-expect-error Optional local authoring plugin has no TypeScript declaration.
    const m = await import('./.vite-source-tags.js');
    plugins.push(m.sourceTags());
  } catch {
    // The optional authoring plugin is not required for a standalone build.
  }

  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']);
  const processEnvDefines: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
  }

  return {
    plugins,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: processEnvDefines,
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
    },
  };
})
