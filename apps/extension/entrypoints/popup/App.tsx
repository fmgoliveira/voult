import { colors } from '@voult/ui-tokens';

export function App() {
  return (
    <main
      style={{
        width: 320,
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
        background: colors.light.background,
        color: colors.light.foreground,
      }}
    >
      <h1 style={{ fontSize: 18, margin: 0 }}>Voult</h1>
      <p style={{ color: colors.light.muted }}>Vault locked. Onboarding comes in phase 4.</p>
    </main>
  );
}
