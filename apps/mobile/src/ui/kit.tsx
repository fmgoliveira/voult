import { Ionicons } from '@expo/vector-icons';
import { avatarGradient, typeColors } from '@voult/ui-tokens';
import { faviconUrl, type ItemType } from '@voult/core';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useId, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
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
import Svg, { Defs, LinearGradient as SvgLinear, Path, Rect, Stop } from 'react-native-svg';
import { useApp } from '../lib/app-store';
import { useTheme } from './theme';

// ------------------------------------------------------------------ background

/**
 * Page background: a flat colour with a barely-there glow at the top. (Not SVG radial blobs:
 * react-native-svg ignores the alpha in `rgba()` stop colours, which made them fully opaque.)
 */
export function Aurora() {
  const { c, aurora } = useTheme();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} />
      <LinearGradient
        colors={[aurora.blobs[0], aurora.blobs[0].replace(/[\d.]+\)$/, '0)')]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 260 }}
      />
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

/** Clean card: solid surface with a hairline border. No shadows (Android draws them as boxes). */
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
  const { c } = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth * 1.5,
          borderColor: strong ? c.borderStrong : c.border,
          backgroundColor: strong ? c.surfaceStrong : c.surface,
          overflow: 'hidden',
        },
        style,
      ]}
    >
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
          <Stop offset="0" stopColor="#4f93ff" />
          <Stop offset="1" stopColor="#1d4ed8" />
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

const brokenIcons = new Set<string>();

/**
 * Logins show the website's own icon (fetched straight from that site, never through a third
 * party) and fall back to a coloured letter. Other types get an icon tile.
 */
export function ItemAvatar({
  type,
  title,
  size = 44,
  urls,
}: {
  type: ItemType;
  title: string;
  size?: number;
  urls?: readonly { url: string }[];
}) {
  const iconsOn = useApp((st) => st.settings.showIcons);
  const src = iconsOn && urls ? faviconUrl(urls) : null;
  const [ok, setOk] = useState(false);
  const [failed, setFailed] = useState(() => (src ? brokenIcons.has(src) : false));
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
        overflow: 'hidden',
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.42 }}>
        {title.trim()[0]!.toUpperCase()}
      </Text>
      {src && !failed ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
            { opacity: ok ? 1 : 0 },
          ]}
        >
          <Image
            source={{ uri: src }}
            style={{ width: size * 0.62, height: size * 0.62 }}
            resizeMode="contain"
            onLoad={(e) => {
              if (e.nativeEvent.source.width > 1) setOk(true);
              else {
                brokenIcons.add(src);
                setFailed(true);
              }
            }}
            onError={() => {
              brokenIcons.add(src);
              setFailed(true);
            }}
          />
        </View>
      ) : null}
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
      ? c.primaryForeground
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
          // Other apps' autofill services must not fight for focus (or be offered the master password).
          importantForAutofill="no"
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
      {icon ? (
        <Ionicons name={icon} size={14} color={active ? c.primaryForeground : c.muted} />
      ) : null}
      {label ? (
        <Text
          style={{
            color: active ? c.primaryForeground : c.foreground,
            fontSize: 13,
            fontWeight: '600',
          }}
        >
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
  Backup: 'cloud-upload-outline',
  'Password health': 'heart-outline',
  Import: 'download-outline',
  About: 'information-circle-outline',
  Devices: 'phone-portrait-outline',
  'Autofill & passkeys': 'key-outline',
};

export function Section({
  title,
  label,
  children,
}: {
  title: string;
  /** Translated heading; `title` stays the stable key for the icon. */
  label?: string;
  children: ReactNode;
}) {
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
          {label ?? title}
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
