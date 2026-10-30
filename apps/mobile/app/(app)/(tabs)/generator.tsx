import {
  generatePassphrase,
  generatePassword,
  type PassphraseOptions,
  type RandomOptions,
} from '@voult/core';
import { useMemo, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { copySecret } from '../../../src/lib/clipboard';
import { Chip, Field, Glass, IconButton, Screen } from '../../../src/ui/kit';
import { useTheme } from '../../../src/ui/theme';

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: c.foreground, fontSize: 16 }}>
        {label}: {value}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        <IconButton
          icon="remove-circle-outline"
          label={`Decrease ${label}`}
          onPress={() => onChange(Math.max(min, value - 1))}
        />
        <IconButton
          icon="add-circle-outline"
          label={`Increase ${label}`}
          onPress={() => onChange(Math.min(max, value + 1))}
        />
      </View>
    </View>
  );
}

export default function Generator() {
  const { c } = useTheme();
  const [mode, setMode] = useState<'random' | 'passphrase'>('random');
  const [random, setRandom] = useState<RandomOptions>({
    length: 20,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
  });
  const [phrase, setPhrase] = useState<PassphraseOptions>({
    words: 5,
    separator: '-',
    capitalize: false,
    appendDigit: false,
  });
  const [nonce, setNonce] = useState(0);

  const value = useMemo(() => {
    void nonce;
    try {
      return mode === 'random' ? generatePassword(random) : generatePassphrase(phrase);
    } catch {
      return '';
    }
  }, [mode, random, phrase, nonce]);

  const toggle = (label: string, v: boolean, set: (b: boolean) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: c.foreground, fontSize: 16 }}>{label}</Text>
      <Switch value={v} onValueChange={set} accessibilityLabel={label} />
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>
        <View style={{ gap: 4 }}>
          <Text
            style={{ color: c.foreground, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}
          >
            Generator
          </Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>Strong passwords and passphrases</Text>
        </View>
        <Glass
          strong
          radius={22}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 16 }}
        >
          <Text
            testID="generated"
            selectable
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 18,
              lineHeight: 26,
              color: c.foreground,
            }}
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
              : 'Select at least one option'}
          </Text>
          <IconButton icon="refresh" label="Regenerate" onPress={() => setNonce(nonce + 1)} />
          <IconButton
            icon="copy-outline"
            label="Copy generated password"
            onPress={() => value && copySecret(value, 'Password copied')}
          />
        </Glass>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Random" active={mode === 'random'} onPress={() => setMode('random')} />
          <Chip
            label="Passphrase"
            active={mode === 'passphrase'}
            onPress={() => setMode('passphrase')}
          />
        </View>
        {mode === 'random' ? (
          <View style={{ gap: 8 }}>
            <Stepper
              label="Length"
              value={random.length}
              min={4}
              max={64}
              onChange={(length) => setRandom({ ...random, length })}
            />
            {toggle('Uppercase (A–Z)', random.upper, (upper) => setRandom({ ...random, upper }))}
            {toggle('Lowercase (a–z)', random.lower, (lower) => setRandom({ ...random, lower }))}
            {toggle('Digits (0–9)', random.digits, (digits) => setRandom({ ...random, digits }))}
            {toggle('Symbols (!@#$)', random.symbols, (symbols) =>
              setRandom({ ...random, symbols }),
            )}
            {toggle('Exclude ambiguous (Il1O0)', random.excludeAmbiguous, (excludeAmbiguous) =>
              setRandom({ ...random, excludeAmbiguous }),
            )}
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Stepper
              label="Words"
              value={phrase.words}
              min={3}
              max={10}
              onChange={(words) => setPhrase({ ...phrase, words })}
            />
            <Field
              label="Separator"
              value={phrase.separator}
              maxLength={3}
              onChangeText={(separator) => setPhrase({ ...phrase, separator })}
            />
            {toggle('Capitalise', phrase.capitalize, (capitalize) =>
              setPhrase({ ...phrase, capitalize }),
            )}
            {toggle('Append a digit', phrase.appendDigit, (appendDigit) =>
              setPhrase({ ...phrase, appendDigit }),
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
