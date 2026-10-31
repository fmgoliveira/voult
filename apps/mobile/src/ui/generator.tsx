import {
  DEFAULT_RANDOM_OPTIONS,
  generatePassphrase,
  generatePassword,
  passphraseEntropyBits,
  randomEntropyBits,
  strengthOf,
  type PassphraseOptions,
  type RandomOptions,
} from '@voult/core';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { copySecret } from '../lib/clipboard';
import { Sheet, Slider, Toggle } from './controls';
import { Button, Glass } from './kit';
import { useTheme } from './theme';

type Mode = 'random' | 'passphrase';

// Remember what the user last chose, for the next time the generator opens.
const remembered: { mode: Mode; random: RandomOptions; phrase: PassphraseOptions } = {
  mode: 'random',
  random: { ...DEFAULT_RANDOM_OPTIONS },
  phrase: { words: 5, separator: '-', capitalize: false, appendDigit: false },
};

const SEPARATORS = [
  { value: '-', label: '-' },
  { value: '.', label: '.' },
  { value: '_', label: '_' },
  { value: ' ', label: 'space' },
  { value: '', label: 'none' },
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const { c } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: c.border,
        borderRadius: 14,
        padding: 4,
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 9,
              borderRadius: 11,
              backgroundColor: on ? c.surfaceSolid : 'transparent',
            }}
          >
            <Text style={{ color: on ? c.foreground : c.muted, fontWeight: '700', fontSize: 14 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OptionRow({
  label,
  hint,
  last,
  children,
}: {
  label: string;
  hint?: string;
  last?: boolean;
  children: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 13,
        gap: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.foreground, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        {hint ? <Text style={{ color: c.muted, fontSize: 12, marginTop: 1 }}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Output, strength and options. Used by the Generator tab and by the "generate" drawer. */
export function GeneratorPanel({ onUse }: { onUse?: (password: string) => void }) {
  const { c } = useTheme();
  const [mode, setModeState] = useState<Mode>(remembered.mode);
  const [random, setRandomState] = useState<RandomOptions>(remembered.random);
  const [phrase, setPhraseState] = useState<PassphraseOptions>(remembered.phrase);
  const [nonce, setNonce] = useState(0);

  const setMode = (m: Mode) => {
    remembered.mode = m;
    setModeState(m);
  };
  const setRandom = (o: RandomOptions) => {
    remembered.random = o;
    setRandomState(o);
  };
  const setPhrase = (o: PassphraseOptions) => {
    remembered.phrase = o;
    setPhraseState(o);
  };

  const value = useMemo(() => {
    void nonce;
    try {
      return mode === 'random' ? generatePassword(random) : generatePassphrase(phrase);
    } catch {
      return '';
    }
  }, [mode, random, phrase, nonce]);

  const bits = mode === 'random' ? randomEntropyBits(random) : passphraseEntropyBits(phrase);
  const strength = strengthOf(bits);
  const barColor = strength.level < 0.3 ? c.danger : strength.level < 0.5 ? c.warning : c.success;

  const sets = (['upper', 'lower', 'digits', 'symbols'] as const).filter((k) => random[k]);
  /** Keep at least one character set on. */
  const toggleSet = (k: 'upper' | 'lower' | 'digits' | 'symbols', on: boolean) => {
    if (!on && sets.length === 1 && sets[0] === k) return;
    setRandom({ ...random, [k]: on });
  };

  return (
    <View style={{ gap: 16 }}>
      <Glass strong radius={24} style={{ padding: 18, gap: 14 }}>
        <Text
          testID="generated"
          selectable
          style={{ fontFamily: 'monospace', fontSize: 22, lineHeight: 32, color: c.foreground }}
        >
          {value
            ? [...value].map((ch, i) => (
                <Text
                  key={i}
                  style={{
                    color: /[0-9]/.test(ch)
                      ? c.primary
                      : /[^A-Za-z0-9]/.test(ch)
                        ? c.accent
                        : c.foreground,
                  }}
                >
                  {ch}
                </Text>
              ))
            : 'Choose at least one option'}
        </Text>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <View
                key={n}
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: n < Math.ceil(strength.level * 5) ? barColor : c.border,
                }}
              />
            ))}
          </View>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {strength.label} · about {Math.round(bits)} bits
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              variant="secondary"
              icon="refresh"
              label="New"
              onPress={() => setNonce(nonce + 1)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="secondary"
              icon="copy-outline"
              label="Copy"
              disabled={!value}
              onPress={() => copySecret(value, 'Password copied')}
            />
          </View>
        </View>
        {onUse ? (
          <Button
            testID="use-generated"
            icon="checkmark"
            label="Use this password"
            disabled={!value}
            onPress={() => onUse(value)}
          />
        ) : null}
      </Glass>

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'random', label: 'Password' },
          { value: 'passphrase', label: 'Passphrase' },
        ]}
      />

      <Glass radius={22} style={{ paddingHorizontal: 18, paddingVertical: 6 }}>
        {mode === 'random' ? (
          <>
            <View
              style={{
                paddingVertical: 14,
                gap: 4,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.foreground, fontSize: 15, fontWeight: '600' }}>Length</Text>
                <Text
                  style={{
                    color: c.primary,
                    fontSize: 15,
                    fontWeight: '800',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {random.length}
                </Text>
              </View>
              <Slider
                accessibilityLabel="Length"
                value={random.length}
                min={8}
                max={64}
                onChange={(length) => setRandom({ ...random, length })}
              />
            </View>
            <OptionRow label="Uppercase" hint="A–Z">
              <Toggle
                accessibilityLabel="Uppercase"
                value={random.upper}
                onValueChange={(v) => toggleSet('upper', v)}
              />
            </OptionRow>
            <OptionRow label="Lowercase" hint="a–z">
              <Toggle
                accessibilityLabel="Lowercase"
                value={random.lower}
                onValueChange={(v) => toggleSet('lower', v)}
              />
            </OptionRow>
            <OptionRow label="Digits" hint="0–9">
              <Toggle
                accessibilityLabel="Digits"
                value={random.digits}
                onValueChange={(v) => toggleSet('digits', v)}
              />
            </OptionRow>
            <OptionRow label="Symbols" hint="!@#$%">
              <Toggle
                accessibilityLabel="Symbols"
                value={random.symbols}
                onValueChange={(v) => toggleSet('symbols', v)}
              />
            </OptionRow>
            <OptionRow label="Avoid look-alikes" hint="Skips I l 1 O 0" last>
              <Toggle
                accessibilityLabel="Avoid look-alikes"
                value={random.excludeAmbiguous}
                onValueChange={(excludeAmbiguous) => setRandom({ ...random, excludeAmbiguous })}
              />
            </OptionRow>
          </>
        ) : (
          <>
            <View
              style={{
                paddingVertical: 14,
                gap: 4,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.foreground, fontSize: 15, fontWeight: '600' }}>Words</Text>
                <Text
                  style={{
                    color: c.primary,
                    fontSize: 15,
                    fontWeight: '800',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {phrase.words}
                </Text>
              </View>
              <Slider
                accessibilityLabel="Words"
                value={phrase.words}
                min={3}
                max={10}
                onChange={(words) => setPhrase({ ...phrase, words })}
              />
            </View>
            <View
              style={{
                paddingVertical: 14,
                gap: 10,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
              }}
            >
              <Text style={{ color: c.foreground, fontSize: 15, fontWeight: '600' }}>
                Separator
              </Text>
              <Segmented
                value={phrase.separator}
                onChange={(separator) => setPhrase({ ...phrase, separator })}
                options={SEPARATORS}
              />
            </View>
            <OptionRow label="Capitalise words">
              <Toggle
                accessibilityLabel="Capitalise"
                value={phrase.capitalize}
                onValueChange={(capitalize) => setPhrase({ ...phrase, capitalize })}
              />
            </OptionRow>
            <OptionRow label="Add a number" last>
              <Toggle
                accessibilityLabel="Append a digit"
                value={phrase.appendDigit}
                onValueChange={(appendDigit) => setPhrase({ ...phrase, appendDigit })}
              />
            </OptionRow>
          </>
        )}
      </Glass>
    </View>
  );
}

/** The generator as a bottom drawer; `onUse` receives the chosen password. */
export function GeneratorSheet({
  visible,
  onClose,
  onUse,
}: {
  visible: boolean;
  onClose: () => void;
  onUse: (password: string) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Generate password" testID="generator-sheet">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}
      >
        <GeneratorPanel
          onUse={(pw) => {
            onUse(pw);
            onClose();
          }}
        />
      </ScrollView>
    </Sheet>
  );
}
