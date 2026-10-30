import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState, type ReactNode } from 'react';
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
import { useTheme } from './theme';

export function Screen({
  children,
  scroll: _s,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: c.background }, style]}
      edges={['top', 'left', 'right']}
    >
      {children}
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ fontSize: 22, fontWeight: '700', color: c.foreground }}
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
    <Text style={[{ fontSize: 15, color: muted ? c.muted : c.foreground }, style]}>{children}</Text>
  );
}

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
  const { c } = useTheme();
  const bg =
    variant === 'primary'
      ? c.primary
      : variant === 'danger'
        ? c.danger
        : variant === 'secondary'
          ? c.surface
          : 'transparent';
  const fg =
    variant === 'primary'
      ? c.primaryForeground
      : variant === 'danger'
        ? '#fff'
        : variant === 'ghost'
          ? c.primary
          : c.foreground;
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
          borderColor: c.border,
          borderWidth: variant === 'secondary' ? 1 : 0,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{label}</Text>
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
      style={({ pressed }) => ({ padding: 8, borderRadius: 999, opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name={icon} size={22} color={color ?? c.muted} />
    </Pressable>
  );
}

export const Field = forwardRef<
  TextInput,
  TextInputProps & { label: string; hint?: string; secret?: boolean }
>(function Field({ label, hint, secret, style, ...p }, ref) {
  const { c } = useTheme();
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <View style={[styles.inputWrap, { borderColor: c.border, backgroundColor: c.background }]}>
        <TextInput
          ref={ref as never}
          accessibilityLabel={label}
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          {...p}
          secureTextEntry={secret && !show}
          style={[{ flex: 1, color: c.foreground, fontSize: 16, paddingVertical: 10 }, style]}
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

export function ErrorText({ children }: { children?: string | null }) {
  const { c } = useTheme();
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: c.danger, fontSize: 13 }}>
      {children}
    </Text>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 4 }}>
      <Body>{title}</Body>
      {body ? <Body muted>{body}</Body> : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: active ? c.primary : c.surface,
      }}
    >
      <Text style={{ color: active ? c.primaryForeground : c.foreground, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        gap: 12,
        paddingVertical: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <Text
        style={{
          color: c.muted,
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
});
