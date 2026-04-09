import { Platform, TextStyle, ViewStyle } from 'react-native';

export const theme = {
  colors: {
    background: '#F8F9FA',
    surface: '#FFFFFF',
    surfaceLow: '#F1F4F6',
    surfaceMid: '#EAEFF1',
    surfaceHigh: '#E2E9EC',
    surfaceDim: '#D1DCE0',
    primary: '#5D5E61',
    primaryDim: '#515255',
    primaryContainer: '#E2E2E5',
    secondary: '#556071',
    secondaryContainer: '#D9E3F7',
    tertiary: '#006D4A',
    tertiaryContainer: '#69F6B8',
    error: '#9F403D',
    errorContainer: '#FE8983',
    text: '#2B3437',
    textMuted: '#586064',
    outline: '#737C7F',
    outlineVariant: '#ABB3B7',
    plateYellow: '#FFD300',
    iosBlue: '#007AFF',
    white: '#FFFFFF',
    black: '#000000',
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    10: 40,
    12: 48,
    14: 56,
    16: 64,
  },
  radius: {
    sm: 10,
    md: 18,
    lg: 28,
    xl: 40,
    full: 999,
  },
  font: {
    regular: Platform.select({ ios: 'System', default: 'sans-serif' }),
    display: Platform.select({ ios: 'System', default: 'sans-serif' }),
  },
};

export const typeRamp: Record<
  'eyebrow' | 'body' | 'bodyLg' | 'title' | 'headline' | 'display',
  TextStyle
> = {
  eyebrow: {
    color: theme.colors.textMuted,
    fontFamily: theme.font.regular,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  body: {
    color: theme.colors.text,
    fontFamily: theme.font.regular,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
  },
  bodyLg: {
    color: theme.colors.textMuted,
    fontFamily: theme.font.regular,
    fontSize: 17,
    fontWeight: '500',
    lineHeight: 25,
  },
  title: {
    color: theme.colors.text,
    fontFamily: theme.font.display,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  headline: {
    color: theme.colors.text,
    fontFamily: theme.font.display,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.3,
    lineHeight: 38,
  },
  display: {
    color: theme.colors.text,
    fontFamily: theme.font.display,
    fontSize: 54,
    fontWeight: '900',
    letterSpacing: -2.5,
    lineHeight: 56,
  },
};

export const shadows: Record<'soft' | 'card' | 'floating', ViewStyle> = {
  soft: {
    shadowColor: theme.colors.text,
    shadowOpacity: 0.04,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  card: {
    shadowColor: theme.colors.text,
    shadowOpacity: 0.07,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3,
  },
  floating: {
    shadowColor: theme.colors.text,
    shadowOpacity: 0.12,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
};

export const ghostBorder = (opacity = 0.15) => ({
  borderColor: `rgba(115, 124, 127, ${opacity})`,
  borderWidth: StyleSheet.hairlineWidth,
});

const StyleSheet = {
  hairlineWidth: Platform.OS === 'ios' ? 0.5 : 1,
};
