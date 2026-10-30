import { Ionicons } from '@expo/vector-icons';
import { avatarGradient, typeColors } from '@voult/ui-tokens';
import type { ItemType } from '@voult/core';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useId, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinear,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { useTheme } from './theme';

// ------------------------------------------------------------------ background

/** Soft colour blobs over a vertical gradient (the "aurora" behind the glass). */
export function Aurora() {
  const { aurora } = useTheme();
  const id = useId().replace(/:/g, '');
  const [a, b, c] = aurora.blobs;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[...aurora.base]} style={StyleSheet.absoluteFill} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {[
            ['a', a],
            ['b', b],
            ['c', c],
          ].map(([key, color]) => (
            <RadialGradient key={key} id={`${id}${key}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        <Circle cx="12%" cy="2%" r="260" fill={`url(#${id}a)`} />
        <Circle cx="108%" cy="30%" r="240" fill={`url(#${id}b)`} />
        <Circle cx="35%" cy="104%" r="280" fill={`url(#${id}c)`} />
      </Svg>
    </View>
  );
}

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Aurora />
      <SafeAreaView style={[{ flex: 1 }, style]} edges={['top', 'left', 'right']}>
        {children}
      </SafeAreaView>
    </View>
  );
}

// ------------------------------------------------------------------ glass

/** Translucent card with a hairline border and a soft top highlight. */
export function Glass({
  children,
  style,
  strong,
  radius = 18,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
  radius?: number;
}) {
  const { c, dark } = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth * 1.5,
          borderColor: strong ? c.borderStrong : c.border,
          backgroundColor: strong ? c.surfaceStrong : c.surface,
          overflow: 'hidden',
          shadowColor: dark ? '#000' : '#4632aa',
          shadowOpacity: dark ? 0.5 : 0.2,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 3,
        },
        style,
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={
          dark
            ? ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)']
            : ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0)']
        }
        style={[StyleSheet.absoluteFill, { height: 56 }]}
      />
      {children}
    </View>
  );
}

// ------------------------------------------------------------------ brand + identity

export function Logo({ size = 32 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Defs>
        <SvgLinear id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#6d5bf7" />
          <Stop offset="1" stopColor="#b06cf7" />
        </SvgLinear>
      </Defs>
      <Rect width="40" height="40" rx="12" fill={`url(#${id})`} />
      <Path
        d="M20 8.5 29.5 12v7.2c0 5.4-3.8 9.8-9.5 12.3-5.7-2.5-9.5-6.9-9.5-12.3V12L20 8.5Z"
        fill="rgba(255,255,255,0.18)"
        stroke="#fff"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M16 20.5l3 3 5.5-6"
        fill="none"
        stroke="#fff"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const TYPE_ICON: Record<ItemType, keyof typeof Ionicons.glyphMap> = {
  login: 'globe-outline',
  note: 'document-text-outline',
  card: 'card-outline',
  identity: 'person-outline',
  totp: 'shield-checkmark-outline',
};

export function TypeTile({ type, size = 44 }: { type: ItemType; size?: number }) {
  const [from, to] = typeColors[type];
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={TYPE_ICON[type]} size={size * 0.5} color="#fff" />
    </LinearGradient>
  );
}

/** Letter avatar for logins (stable colour per title); icon tile for everything else. */
export function ItemAvatar({
  type,
  title,
  size = 44,
}: {
  type: ItemType;
  title: string;
  size?: number;
}) {
  if (type !== 'login' || !title.trim()) return <TypeTile type={type} size={size} />;
  const [from, to] = avatarGradient(title.toLowerCase());
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.42 }}>
        {title.trim()[0]!.toUpperCase()}
      </Text>
    </LinearGradient>
  );
}

// ------------------------------------------------------------------ text

export function Heading({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.5, color: c.foreground }}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: object;
}) {
  const { c } = useTheme();
  return (
    <Text style={[{ fontSize: 15, lineHeight: 21, color: muted ? c.muted : c.foreground }, style]}>
      {children}
    </Text>
  );
}

// ------------------------------------------------------------------ buttons

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
}) {
  const { c, brand } = useTheme();
  const off = disabled || busy;
  const fg =
    variant === 'primary' || variant === 'danger'
      ? '#fff'
      : variant === 'ghost'
        ? c.primary
        : c.foreground;
  const content = (
    <>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '700' }}>{label}</Text>
    </>
  );
  const gradient =
    variant === 'primary'
      ? [brand[0], brand[1]]
      : variant === 'danger'
        ? ['#f43f5e', '#e11d48']
        : null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => ({
        opacity: off ? 0.5 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        borderRadius: 14,
        shadowColor: variant === 'primary' ? brand[0] : '#000',
        shadowOpacity: gradient ? 0.45 : 0,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: gradient ? 4 : 0,
      })}
    >
      {gradient ? (
        <LinearGradient
          colors={gradient as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.button}
        >
          {content}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.button,
            variant === 'secondary' && {
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: c.border,
            },
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: 8,
        borderRadius: 12,
        backgroundColor: pressed ? c.surface : 'transparent',
      })}
    >
      <Ionicons name={icon} size={21} color={color ?? c.muted} />
    </Pressable>
  );
}

/** Square glass button, e.g. back / lock in headers. */
export function GlassIconButton({
  icon,
  label,
  onPress,
  color,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.92 : 1 }] })}
    >
      <Glass
        radius={13}
        style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name={icon} size={20} color={color ?? c.foreground} />
      </Glass>
    </Pressable>
  );
}

// ------------------------------------------------------------------ inputs

export const Field = forwardRef<
  TextInput,
  TextInputProps & {
    label: string;
    hint?: string;
    secret?: boolean;
    icon?: keyof typeof Ionicons.glyphMap;
  }
>(function Field({ label, hint, secret, icon, style, ...p }, ref) {
  const { c } = useTheme();
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>
        {label}
      </Text>
      <View
        style={[
          styles.inputWrap,
          { borderColor: focused ? c.primary : c.border, backgroundColor: c.surface },
          focused && {
            shadowColor: c.primary,
            shadowOpacity: 0.35,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
            elevation: 2,
          },
        ]}
      >
        {icon ? (
          <Ionicons name={icon} size={18} color={c.muted} style={{ marginRight: 8 }} />
        ) : null}
        <TextInput
          ref={ref as never}
          accessibilityLabel={label}
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          {...p}
          onFocus={(e) => {
            setFocused(true);
            p.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            p.onBlur?.(e);
          }}
          secureTextEntry={secret && !show}
          style={[{ flex: 1, color: c.foreground, fontSize: 16, paddingVertical: 12 }, style]}
        />
        {secret && (
          <IconButton
            icon={show ? 'eye-off-outline' : 'eye-outline'}
            label={show ? `Hide ${label}` : `Show ${label}`}
            onPress={() => setShow(!show)}
          />
        )}
      </View>
      {hint ? <Text style={{ color: c.muted, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  );
});

export function SearchBar(props: TextInputProps) {
  const { c } = useTheme();
  return (
    <Glass
      radius={14}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}
    >
      <Ionicons name="search" size={18} color={c.muted} />
      <TextInput
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={{ flex: 1, color: c.foreground, fontSize: 16, paddingVertical: 12 }}
      />
    </Glass>
  );
}

// ------------------------------------------------------------------ misc

export function ErrorText({ children }: { children?: string | null }) {
  const { c } = useTheme();
  if (!children) return null;
  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.danger + '55',
        backgroundColor: c.danger + '1a',
        padding: 10,
      }}
    >
      <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 13 }}>
        {children}
      </Text>
    </View>
  );
}

export function Empty({
  title,
  body,
  icon = 'shield-checkmark-outline',
}: {
  title: string;
  body?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
      <Glass
        radius={26}
        style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name={icon} size={30} color={c.primary} />
      </Glass>
      <Text style={{ color: c.foreground, fontSize: 17, fontWeight: '700' }}>{title}</Text>
      {body ? <Text style={{ color: c.muted, textAlign: 'center' }}>{body}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { c, brand } = useTheme();
  const inner = (
    <>
      {icon ? <Ionicons name={icon} size={14} color={active ? '#fff' : c.muted} /> : null}
      {label ? (
        <Text style={{ color: active ? '#fff' : c.foreground, fontSize: 13, fontWeight: '600' }}>
          {label}
        </Text>
      ) : null}
    </>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label || icon}
      accessibilityState={{ selected: active }}
      onPress={onPress}
    >
      {active ? (
        <LinearGradient
          colors={[brand[0], brand[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.chip}
        >
          {inner}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.chip,
            { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
          ]}
        >
          {inner}
        </View>
      )}
    </Pressable>
  );
}

const SECTION_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Account: 'person-outline',
  Security: 'shield-checkmark-outline',
  Appearance: 'color-palette-outline',
  Devices: 'phone-portrait-outline',
};

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const { c, brand } = useTheme();
  return (
    <Glass style={{ padding: 16, gap: 14, marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <LinearGradient
          colors={[brand[0], brand[1]]}
          style={{
            width: 26,
            height: 26,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={SECTION_ICON[title] ?? 'ellipse-outline'} size={14} color="#fff" />
        </LinearGradient>
        <Text
          style={{
            color: c.muted,
            fontSize: 12,
            fontWeight: '800',
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          {title}
        </Text>
      </View>
      {children}
    </Glass>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
});

/** Centered logo with a soft glow, title and subtitle for the onboarding / unlock screens. */
export function AuthHero({ title, subtitle }: { title: string; subtitle?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingTop: 24, paddingBottom: 8 }}>
      <View>
        <View
          style={{
            position: 'absolute',
            top: -10,
            left: -10,
            right: -10,
            bottom: -10,
            borderRadius: 40,
            backgroundColor: c.primary,
            opacity: 0.25,
          }}
        />
        <Logo size={64} />
      </View>
      <Text
        style={{
          color: c.foreground,
          fontSize: 26,
          fontWeight: '800',
          letterSpacing: -0.5,
          marginTop: 8,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: c.muted, fontSize: 14, textAlign: 'center', maxWidth: 300 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
