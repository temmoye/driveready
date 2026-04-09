import React, { PropsWithChildren, useEffect, useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type StyleProp,
  type ViewStyle,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  AlertSummary,
  ComplianceStatus,
  DocumentStatus,
  DocumentSummary,
  ParkingSuggestion,
  SavedZone,
  SupportItem,
  VehicleSummary,
} from './api/types';
import type { LocalUploadAsset } from './api/client';
import { hasMapboxToken, searchDestinationSuggestions, type DestinationSuggestion } from './api/mapbox';
import { useDriveReadyModel } from './hooks/useDriveReadyModel';
import { ghostBorder, shadows, theme, typeRamp } from './theme';

type AuthRoute = 'welcome' | 'features' | 'signIn' | 'createAccount' | 'resetPassword';
type AppTab = 'home' | 'garage' | 'alerts' | 'docs' | 'settings';
type AppRoute =
  | { name: 'tabs'; tab: AppTab }
  | { name: 'addVehicle' }
  | { name: 'vehicleDetail'; vehicleId: string }
  | { name: 'editVehicle'; vehicleId: string }
  | { name: 'alertDetail'; alertId: string }
  | { name: 'uploadDocument'; vehicleId?: string }
  | { name: 'documentDetail'; documentId: string }
  | { name: 'tripCheck' }
  | { name: 'savedZones' }
  | { name: 'profile' }
  | { name: 'support' };

const initialAppRoute: AppRoute = { name: 'tabs', tab: 'home' };

interface PasswordRecoveryState {
  access_token: string;
  refresh_token?: string;
  expires_at: string;
}

function readLinkParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === 'string' ? value : undefined;
}

function decodeLinkParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveRecoveryExpiry(params: URLSearchParams) {
  const expiresAt = Number(params.get('expires_at'));

  if (Number.isFinite(expiresAt) && expiresAt > 0) {
    return new Date(expiresAt * 1000).toISOString();
  }

  const expiresIn = Number(params.get('expires_in'));

  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function getPasswordRecoveryFromUrl(url: string) {
  const parsed = Linking.parse(url);
  const params = new URLSearchParams();

  Object.entries(parsed.queryParams ?? {}).forEach(([key, value]) => {
    const normalizedValue = readLinkParam(value);

    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  });

  const hashFragment = url.split('#')[1];

  if (hashFragment) {
    const hashParams = new URLSearchParams(hashFragment);
    hashParams.forEach((value, key) => {
      params.set(key, value);
    });
  }

  const errorMessage = params.get('error_description') ?? params.get('error');

  if (errorMessage) {
    return {
      error: decodeLinkParam(errorMessage),
    };
  }

  const accessToken = params.get('access_token');

  if (!accessToken || params.get('type') !== 'recovery') {
    return null;
  }

  return {
    recovery: {
      access_token: accessToken,
      refresh_token: params.get('refresh_token') ?? undefined,
      expires_at: resolveRecoveryExpiry(params),
    } satisfies PasswordRecoveryState,
  };
}

function DriveReadyRoot() {
  const model = useDriveReadyModel();
  const [authStack, setAuthStack] = useState<AuthRoute[]>(['welcome']);
  const [appStack, setAppStack] = useState<AppRoute[]>([initialAppRoute]);
  const [passwordRecovery, setPasswordRecovery] = useState<PasswordRecoveryState | null>(null);
  const incomingUrl = Linking.useURL();
  const passwordResetRedirectUrl = useMemo(() => Linking.createURL('reset-password'), []);

  useEffect(() => {
    if (model.session) {
      setPasswordRecovery(null);
      setAppStack([initialAppRoute]);
    } else if (!passwordRecovery) {
      setAuthStack(['welcome']);
    }
  }, [model.session, passwordRecovery]);

  useEffect(() => {
    if (!incomingUrl) {
      return;
    }

    const passwordRecoveryResult = getPasswordRecoveryFromUrl(incomingUrl);

    if (!passwordRecoveryResult) {
      return;
    }

    if ('error' in passwordRecoveryResult) {
      Alert.alert('Reset link invalid', passwordRecoveryResult.error);
      return;
    }

    setPasswordRecovery(passwordRecoveryResult.recovery);
    setAuthStack(['signIn']);
  }, [incomingUrl]);

  const authRoute = authStack[authStack.length - 1];
  const appRoute = appStack[appStack.length - 1];

  const pushAuth = (route: AuthRoute) => {
    setAuthStack((previous) => [...previous, route]);
  };

  const replaceAuth = (route: AuthRoute) => {
    setAuthStack([route]);
  };

  const popAuth = () => {
    setAuthStack((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous));
  };

  const pushApp = (route: AppRoute) => {
    setAppStack((previous) => [...previous, route]);
  };

  const popApp = () => {
    setAppStack((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous));
  };

  const setTab = (tab: AppTab) => {
    setAppStack([{ name: 'tabs', tab }]);
  };

  if (model.isLoading) {
    return <LoadingState label="Loading DriveReady" detail="Connecting to the local backend and preparing your app." />;
  }

  if (model.error && !model.session) {
    return (
      <ConnectionErrorState
        detail={model.error}
        onRetry={() => {
          void model.refreshAll();
        }}
      />
    );
  }

  if (passwordRecovery) {
    return (
      <ResetPasswordConfirmScreen
        onBack={() => {
          setPasswordRecovery(null);
          replaceAuth('signIn');
        }}
        onSubmit={async (password) => {
          await model.confirmPasswordReset({
            ...passwordRecovery,
            password,
          });
          setPasswordRecovery(null);
          Alert.alert('Password updated', 'Your password has been changed and you are now signed in.');
        }}
      />
    );
  }

  if (!model.session) {
    if (authRoute === 'welcome') {
      return (
        <WelcomeScreen
          onExistingUser={() => replaceAuth('signIn')}
          onNewUser={() => replaceAuth('features')}
        />
      );
    }

    if (authRoute === 'features') {
      return (
        <FeaturesScreen
          onBack={popAuth}
          onContinue={() => replaceAuth('createAccount')}
          onSkip={() => replaceAuth('createAccount')}
        />
      );
    }

    if (authRoute === 'signIn') {
      return (
        <SignInScreen
          onCreateAccount={() => replaceAuth('createAccount')}
          onResetPassword={() => pushAuth('resetPassword')}
          onSignIn={model.signIn}
        />
      );
    }

    if (authRoute === 'createAccount') {
      return (
        <CreateAccountScreen
          onBack={() => replaceAuth('welcome')}
          onSignIn={() => replaceAuth('signIn')}
          onSubmit={model.signUp}
        />
      );
    }

    return (
      <ResetPasswordScreen
        onBack={popAuth}
        onSubmit={(email) => model.requestReset(email, passwordResetRedirectUrl)}
      />
    );
  }

  if (appRoute.name === 'tabs') {
    return (
      <TabbedExperience
        activeTab={appRoute.tab}
        model={model}
        onAddVehicle={() => pushApp({ name: 'addVehicle' })}
        onOpenAlert={(alertId) => pushApp({ name: 'alertDetail', alertId })}
        onOpenDocument={(documentId) => pushApp({ name: 'documentDetail', documentId })}
        onOpenProfile={() => pushApp({ name: 'profile' })}
        onOpenSupport={() => pushApp({ name: 'support' })}
        onOpenTripCheck={() => pushApp({ name: 'tripCheck' })}
        onOpenVehicle={(vehicleId) => pushApp({ name: 'vehicleDetail', vehicleId })}
        onOpenZones={() => pushApp({ name: 'savedZones' })}
        onTabChange={setTab}
        onUploadDocument={(vehicleId) => pushApp({ name: 'uploadDocument', vehicleId })}
      />
    );
  }

  if (appRoute.name === 'addVehicle') {
    return (
      <AddVehicleScreen
        onBack={popApp}
        onSubmit={async (payload) => {
          await model.createVehicle(payload);
          setTab('garage');
        }}
      />
    );
  }

  if (appRoute.name === 'vehicleDetail') {
    return (
      <VehicleDetailScreen
        enrichVehicle={model.enrichVehicle}
        onBack={popApp}
        onEdit={() => pushApp({ name: 'editVehicle', vehicleId: appRoute.vehicleId })}
        onOpenDocument={(documentId) => pushApp({ name: 'documentDetail', documentId })}
        onRunTripCheck={() => pushApp({ name: 'tripCheck' })}
        vehicleId={appRoute.vehicleId}
        model={model}
      />
    );
  }

  if (appRoute.name === 'editVehicle') {
    return (
      <EditVehicleScreen
        onBack={popApp}
        onDelete={async (vehicleId) => {
          await model.deleteVehicle(vehicleId);
          setTab('garage');
        }}
        onSubmit={async (vehicleId, payload) => {
          await model.updateVehicle(vehicleId, payload);
          popApp();
        }}
        vehicleId={appRoute.vehicleId}
        vehicles={model.vehicles}
      />
    );
  }

  if (appRoute.name === 'alertDetail') {
    return (
      <AlertDetailScreen
        alertId={appRoute.alertId}
        loadAlert={model.loadAlert}
        onBack={popApp}
        onSave={async (alertId, payload) => {
          await model.updateAlert(alertId, payload);
          popApp();
        }}
      />
    );
  }

  if (appRoute.name === 'uploadDocument') {
    return (
      <UploadDocumentScreen
        initialVehicleId={appRoute.vehicleId}
        onBack={popApp}
        onSubmit={async (payload, asset) => {
          await model.createDocument(payload, asset);
          setTab('docs');
        }}
        vehicles={model.vehicles}
      />
    );
  }

  if (appRoute.name === 'documentDetail') {
    return (
      <DocumentDetailScreen
        documentId={appRoute.documentId}
        loadDocument={model.loadDocument}
        onBack={popApp}
        onDelete={async (documentId) => {
          await model.deleteDocument(documentId);
          setTab('docs');
        }}
        onSave={async (documentId, payload) => {
          await model.updateDocument(documentId, payload);
          popApp();
        }}
        onReplaceFile={async (documentId, asset) => {
          const uploaded = await model.uploadFileAsset(asset);
          await model.updateDocument(documentId, {
            file_key: uploaded.upload.file_key,
            file_name: uploaded.upload.file_name,
            mime_type: uploaded.upload.mime_type,
          });
        }}
        onShare={model.shareDocument}
      />
    );
  }

  if (appRoute.name === 'tripCheck') {
    return (
      <TripCheckScreen
        onBack={popApp}
        onRunTripCheck={model.runTripCheck}
        tripChecks={model.tripChecks}
        vehicles={model.vehicles}
        zones={model.zones}
      />
    );
  }

  if (appRoute.name === 'savedZones') {
    return (
      <SavedZonesScreen
        onBack={popApp}
        onCreateZone={model.createZone}
        onDeleteZone={model.deleteZone}
        onUpdateZone={model.updateZone}
        zones={model.zones}
      />
    );
  }

  if (appRoute.name === 'profile') {
    return (
      <ProfileScreen
        onBack={popApp}
        onSubmit={async (payload) => {
          await model.updateProfile(payload);
          popApp();
        }}
        user={model.user}
      />
    );
  }

  return (
    <SupportScreen
      items={model.supportItems}
      onBack={popApp}
      onExportRequest={model.exportRequest}
    />
  );
}

interface TabbedExperienceProps {
  activeTab: AppTab;
  model: ReturnType<typeof useDriveReadyModel>;
  onAddVehicle: () => void;
  onOpenAlert: (alertId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onOpenProfile: () => void;
  onOpenSupport: () => void;
  onOpenTripCheck: () => void;
  onOpenVehicle: (vehicleId: string) => void;
  onOpenZones: () => void;
  onTabChange: (tab: AppTab) => void;
  onUploadDocument: (vehicleId?: string) => void;
}

function TabbedExperience({
  activeTab,
  model,
  onAddVehicle,
  onOpenAlert,
  onOpenDocument,
  onOpenProfile,
  onOpenSupport,
  onOpenTripCheck,
  onOpenVehicle,
  onOpenZones,
  onTabChange,
  onUploadDocument,
}: TabbedExperienceProps) {
  const insets = useSafeAreaInsets();
  const vehicle = model.selectedVehicle ?? model.vehicles[0] ?? null;

  let content = (
    <HomeScreen
      alerts={model.alerts}
      dashboard={model.dashboard}
      onAddVehicle={onAddVehicle}
      onOpenAlerts={() => onTabChange('alerts')}
      onOpenDocs={() => onTabChange('docs')}
      onUploadDocument={() => onUploadDocument(vehicle?.id)}
      onOpenTripCheck={onOpenTripCheck}
      onOpenVehicle={onOpenVehicle}
      selectedVehicle={vehicle}
    />
  );

  if (activeTab === 'garage') {
    content = <GarageScreen onAddVehicle={onAddVehicle} onOpenVehicle={onOpenVehicle} vehicles={model.vehicles} />;
  }

  if (activeTab === 'alerts') {
    content = <AlertsScreen alerts={model.alerts} onOpenAlert={onOpenAlert} />;
  }

  if (activeTab === 'docs') {
    content = (
      <DocsScreen
        documents={model.documents}
        onOpenDocument={onOpenDocument}
        onUploadDocument={onUploadDocument}
        vehicles={model.vehicles}
      />
    );
  }

  if (activeTab === 'settings') {
    content = (
      <SettingsScreen
        notificationPreferences={model.notificationPreferences}
        onOpenProfile={onOpenProfile}
        onOpenSupport={onOpenSupport}
        onOpenZones={onOpenZones}
        onSignOut={model.signOut}
        onUpdateNotificationPreferences={model.updateNotificationPreferences}
        onUpdatePermissionStates={model.updatePermissionStates}
        permissionStates={model.permissionStates}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <StatusBar style="dark" />
      <View style={styles.flex}>{content}</View>
      <TabBar activeTab={activeTab} bottomInset={insets.bottom} onTabChange={onTabChange} />
    </View>
  );
}

function WelcomeScreen({
  onExistingUser,
  onNewUser,
}: {
  onExistingUser: () => void;
  onNewUser: () => void;
}) {
  return (
    <AuthScaffold>
      <View style={styles.heroIconWrap}>
        <MaterialCommunityIcons color={theme.colors.primary} name="shield-car" size={44} />
      </View>
      <Text style={styles.authDisplay}>DriveReady UK</Text>
      <Text style={styles.authBody}>Keep MOT, tax, insurance, documents, and charge-zone checks in one clean flow.</Text>
      <View style={styles.heroImageCard}>
        <Image
          resizeMode="cover"
          source={{
            uri: 'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1200&q=80',
          }}
          style={styles.heroImage}
        />
      </View>
      <View style={styles.authButtonStack}>
        <PrimaryButton label="I’m New" onPress={onNewUser} />
        <SecondaryButton label="I Already Have An Account" onPress={onExistingUser} />
      </View>
    </AuthScaffold>
  );
}

function FeaturesScreen({
  onBack,
  onContinue,
  onSkip,
}: {
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <AuthScaffold>
      <BackButton onPress={onBack} />
      <Text style={styles.screenEyebrow}>New user journey</Text>
      <Text style={styles.authTitle}>What DriveReady actually does</Text>
      <View style={styles.featureStack}>
        <FeatureCard icon="notifications-active" title="Stay road-ready" body="Date-driven reminders for MOT, tax, insurance, and expiring docs." />
        <FeatureCard icon="map" title="Check trips before you leave" body="See likely charge-zone impact and lower-cost parking suggestions for a chosen vehicle." />
        <FeatureCard icon="folder-open" title="Keep records together" body="Store vehicle files, spot missing paperwork, and open detail screens from one garage." />
      </View>
      <View style={styles.authButtonStack}>
        <PrimaryButton label="Continue" onPress={onContinue} />
        <Pressable onPress={onSkip} style={styles.inlineCenter}>
          <Text style={styles.textLink}>Skip into account setup</Text>
        </Pressable>
      </View>
    </AuthScaffold>
  );
}

function SignInScreen({
  onCreateAccount,
  onResetPassword,
  onSignIn,
}: {
  onCreateAccount: () => void;
  onResetPassword: () => void;
  onSignIn: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing details', 'Enter your email and password to continue.');
      return;
    }

    setIsSubmitting(true);

    try {
      await onSignIn(email, password);
    } catch (error) {
      Alert.alert('Sign in failed', getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardScaffold>
      <AuthCard
        body="Sign in to view your garage, alerts, docs, and trip checks."
        title="Welcome back"
      >
        <InputField label="Email" onChangeText={setEmail} value={email} />
        <InputField label="Password" onChangeText={setPassword} secureTextEntry value={password} />
        <PrimaryButton label={isSubmitting ? 'Signing In...' : 'Sign In'} onPress={submit} />
        <SecondaryButton icon="fingerprint" label="Use Face ID / Touch ID" onPress={submit} />
        <Pressable onPress={onResetPassword} style={styles.inlineCenter}>
          <Text style={styles.textLink}>Forgot password?</Text>
        </Pressable>
        <Pressable onPress={onCreateAccount} style={styles.inlineCenter}>
          <Text style={styles.textLink}>Create a new account</Text>
        </Pressable>
      </AuthCard>
    </KeyboardScaffold>
  );
}

function CreateAccountScreen({
  onBack,
  onSignIn,
  onSubmit,
}: {
  onBack: () => void;
  onSignIn: () => void;
  onSubmit: (payload: { first_name: string; last_name: string; email: string; password: string }) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || password.length < 8) {
      Alert.alert('Check your details', 'Enter your name, a valid email, and a password with at least 8 characters.');
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit({
        first_name: firstName,
        last_name: lastName,
        email,
        password,
      });
    } catch (error) {
      Alert.alert('Unable to create account', getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardScaffold>
      <AuthCard body="Set up your account before adding your first vehicle." title="Create account">
        <BackButton onPress={onBack} />
        <InputField label="First name" onChangeText={setFirstName} value={firstName} />
        <InputField label="Last name" onChangeText={setLastName} value={lastName} />
        <InputField label="Email" onChangeText={setEmail} value={email} />
        <InputField label="Password" onChangeText={setPassword} secureTextEntry value={password} />
        <PrimaryButton label={isSubmitting ? 'Creating...' : 'Create Account'} onPress={submit} />
        <Pressable onPress={onSignIn} style={styles.inlineCenter}>
          <Text style={styles.textLink}>Already have an account?</Text>
        </Pressable>
      </AuthCard>
    </KeyboardScaffold>
  );
}

function ResetPasswordScreen({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      Alert.alert('Missing email', 'Enter the email linked to your DriveReady account.');
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit(email);
      Alert.alert('Check your email', 'DriveReady has sent a reset link. Open it on this device to choose a new password.');
      onBack();
    } catch (error) {
      Alert.alert('Reset failed', getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardScaffold>
      <AuthCard body="Enter your email and DriveReady will send a link that reopens the app to finish recovery." title="Reset password">
        <BackButton onPress={onBack} />
        <InputField keyboardType="email-address" label="Email" onChangeText={setEmail} value={email} />
        <PrimaryButton label={isSubmitting ? 'Sending...' : 'Send Reset Link'} onPress={submit} />
      </AuthCard>
    </KeyboardScaffold>
  );
}

function ResetPasswordConfirmScreen({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (password.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters for your new password.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Enter the same new password in both fields.');
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit(password);
    } catch (error) {
      Alert.alert('Unable to update password', getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardScaffold>
      <AuthCard body="Set a new password to finish the recovery link you opened from email." title="Choose a new password">
        <BackButton onPress={onBack} />
        <InputField label="New password" onChangeText={setPassword} secureTextEntry value={password} />
        <InputField label="Confirm new password" onChangeText={setConfirmPassword} secureTextEntry value={confirmPassword} />
        <PrimaryButton label={isSubmitting ? 'Updating...' : 'Update Password'} onPress={submit} />
      </AuthCard>
    </KeyboardScaffold>
  );
}

function HomeScreen({
  alerts,
  dashboard,
  onAddVehicle,
  onOpenAlerts,
  onOpenDocs,
  onUploadDocument,
  onOpenTripCheck,
  onOpenVehicle,
  selectedVehicle,
}: {
  alerts: AlertSummary[];
  dashboard: ReturnType<typeof useDriveReadyModel>['dashboard'];
  onAddVehicle: () => void;
  onOpenAlerts: () => void;
  onOpenDocs: () => void;
  onUploadDocument: () => void;
  onOpenTripCheck: () => void;
  onOpenVehicle: (vehicleId: string) => void;
  selectedVehicle: VehicleSummary | null;
}) {
  if (!selectedVehicle) {
    return <EmptyStateScreen actionLabel="Add vehicle" onAction={onAddVehicle} title="No vehicles yet" body="Create your first vehicle to start reminders, docs, and trip checks." />;
  }

  return (
    <ScreenScaffold actionIcon="upload-file" onActionPress={onUploadDocument} title="DriveReady UK">
      <AppScrollView contentContainerStyle={styles.scrollContent}>
        <PrimaryButton label="Upload document" onPress={onUploadDocument} />
        <HeroVehicleCard onPress={() => onOpenVehicle(selectedVehicle.id)} vehicle={selectedVehicle} />

        <SectionTitle actionLabel="Trip Check" onAction={onOpenTripCheck} title="Today" />
        <View style={styles.summaryGrid}>
          {(dashboard?.summary_cards ?? []).map((card) => (
            <MetricCard key={card.id} label={card.label} tone={card.tone} value={card.value} />
          ))}
        </View>

        <SectionTitle title="Quick actions" />
        <View style={styles.quickRow}>
          <QuickActionCard icon="add-circle-outline" label="Add vehicle" onPress={onAddVehicle} />
          <QuickActionCard icon="upload-file" label="Upload" onPress={onUploadDocument} />
          <QuickActionCard icon="notifications" label="Alerts" onPress={onOpenAlerts} />
          <QuickActionCard icon="map" label="Trip Check" onPress={onOpenTripCheck} />
        </View>

        <SectionTitle title="Next actions" />
        {(dashboard?.next_actions ?? []).map((action) => (
          <ActionCard
            key={action.id}
            onPress={action.screen === 'alerts' ? onOpenAlerts : action.screen === 'docs' ? onOpenDocs : onOpenTripCheck}
            subtitle={action.subtitle}
            title={action.title}
          />
        ))}

        <SectionTitle title="Open reminders" />
        {alerts.length === 0 ? (
          <ListCard body="When reminders are generated, your next actions will show up here." title="No open reminders" />
        ) : (
          alerts.slice(0, 3).map((alert) => (
            <ListCard
              key={alert.id}
              badge={alertToneLabel(alert.tone)}
              body={alert.detail}
              title={alert.title}
            />
          ))
        )}
      </AppScrollView>
    </ScreenScaffold>
  );
}

function GarageScreen({
  onAddVehicle,
  onOpenVehicle,
  vehicles,
}: {
  onAddVehicle: () => void;
  onOpenVehicle: (vehicleId: string) => void;
  vehicles: VehicleSummary[];
}) {
  if (vehicles.length === 0) {
    return <EmptyStateScreen actionLabel="Add vehicle" onAction={onAddVehicle} title="Garage is empty" body="Add a vehicle to start reminders, docs, and Trip Check." />;
  }

  return (
    <ScreenScaffold actionIcon="add" onActionPress={onAddVehicle} title="Garage">
      <AppScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionIntro}>Manage vehicles, open detail records, and fix anything that is close to expiry.</Text>
        {vehicles.map((vehicle) => (
          <Pressable key={vehicle.id} onPress={() => onOpenVehicle(vehicle.id)} style={({ pressed }) => [styles.vehicleRow, pressed && styles.pressed]}>
            <Image source={{ uri: vehicle.image_url }} style={styles.vehicleThumb} />
            <View style={styles.flex}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{vehicle.nickname}</Text>
                <StatusPill label={readinessLabel(vehicle.readiness_status)} tone={vehicle.readiness_tone} />
              </View>
              <Text style={styles.cardBody}>{vehicle.make_model}</Text>
              <Text style={styles.cardMeta}>{vehicle.registration_plate} · MOT {formatDate(vehicle.mot_due_at)}</Text>
            </View>
          </Pressable>
        ))}
      </AppScrollView>
    </ScreenScaffold>
  );
}

function AlertsScreen({
  alerts,
  onOpenAlert,
}: {
  alerts: AlertSummary[];
  onOpenAlert: (alertId: string) => void;
}) {
  const [filter, setFilter] = useState<'open' | 'handled'>('open');
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () =>
      alerts.filter((alert) => {
        if (alert.status !== filter) {
          return false;
        }

        if (!query.trim()) {
          return true;
        }

        return [alert.title, alert.subtitle, alert.detail].some((value) => value.toLowerCase().includes(query.toLowerCase()));
      }),
    [alerts, filter, query],
  );

  return (
    <ScreenScaffold title="Alerts">
      <AppScrollView contentContainerStyle={styles.scrollContent}>
        <SegmentControl
          options={[
            { key: 'open', label: 'Open' },
            { key: 'handled', label: 'Handled' },
          ]}
          selected={filter}
          onSelect={(value) => setFilter(value as 'open' | 'handled')}
        />
        <InputField label="Search alerts" onChangeText={setQuery} placeholder="Search by vehicle or reminder" value={query} />
        {filtered.length === 0 ? (
          <ListCard body="Try another filter or search term." title="No alerts match" />
        ) : (
          filtered.map((alert) => (
            <Pressable key={alert.id} onPress={() => onOpenAlert(alert.id)} style={({ pressed }) => [styles.listCard, pressed && styles.pressed]}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{alert.title}</Text>
                <StatusPill label={alertToneLabel(alert.tone)} tone={alert.tone} />
              </View>
              <Text style={styles.cardBody}>{alert.detail}</Text>
              <Text style={styles.cardMeta}>{alert.subtitle} · Due {formatDate(alert.due_at)}</Text>
            </Pressable>
          ))
        )}
      </AppScrollView>
    </ScreenScaffold>
  );
}

function DocsScreen({
  documents,
  onOpenDocument,
  onUploadDocument,
  vehicles,
}: {
  documents: DocumentSummary[];
  onOpenDocument: (documentId: string) => void;
  onUploadDocument: (vehicleId?: string) => void;
  vehicles: VehicleSummary[];
}) {
  const [filter, setFilter] = useState<DocumentStatus | 'all'>('all');

  const filtered = documents.filter((document) => (filter === 'all' ? true : document.status === filter));
  const canUpload = vehicles.length > 0;

  return (
    <ScreenScaffold
      actionIcon={canUpload ? 'upload-file' : undefined}
      onActionPress={canUpload ? () => onUploadDocument(vehicles[0]?.id) : undefined}
      title="Docs"
    >
      <AppScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionIntro}>Keep MOT, insurance, V5C, and service files together here.</Text>
        {canUpload ? (
          <>
            <PrimaryButton label="Upload document" onPress={() => onUploadDocument(vehicles[0]?.id)} />
            <SegmentControl
              options={[
                { key: 'all', label: 'All' },
                { key: 'current', label: 'Current' },
                { key: 'needs_review', label: 'Needs review' },
                { key: 'expired', label: 'Expired' },
              ]}
              selected={filter}
              onSelect={(value) => setFilter(value as DocumentStatus | 'all')}
            />
            {filtered.length === 0 ? (
              <ListCard body="Upload your first file or switch filters." title="No documents here" />
            ) : (
              filtered.map((document) => (
                <Pressable key={document.id} onPress={() => onOpenDocument(document.id)} style={({ pressed }) => [styles.listCard, pressed && styles.pressed]}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>{document.title}</Text>
                    <StatusPill label={documentStatusLabel(document.status)} tone={documentTone(document.status)} />
                  </View>
                  <Text style={styles.cardBody}>{documentTypeLabel(document.document_type)}</Text>
                  <Text style={styles.cardMeta}>Expires {formatDate(document.expires_at)} · {document.file_name}</Text>
                </Pressable>
              ))
            )}
          </>
        ) : (
          <ListCard
            body="Add a vehicle first. Every document in DriveReady is linked to a vehicle record."
            title="Upload starts after garage setup"
          />
        )}
      </AppScrollView>
    </ScreenScaffold>
  );
}

function SettingsScreen({
  notificationPreferences,
  onOpenProfile,
  onOpenSupport,
  onOpenZones,
  onSignOut,
  onUpdateNotificationPreferences,
  onUpdatePermissionStates,
  permissionStates,
}: {
  notificationPreferences: ReturnType<typeof useDriveReadyModel>['notificationPreferences'];
  onOpenProfile: () => void;
  onOpenSupport: () => void;
  onOpenZones: () => void;
  onSignOut: () => Promise<void>;
  onUpdateNotificationPreferences: (payload: Record<string, unknown>) => Promise<void>;
  onUpdatePermissionStates: (payload: Record<string, unknown>) => Promise<void>;
  permissionStates: ReturnType<typeof useDriveReadyModel>['permissionStates'];
}) {
  const togglePreference = async (key: string, value: boolean) => {
    try {
      await onUpdateNotificationPreferences({
        [key]: value,
      });
    } catch (error) {
      Alert.alert('Unable to update reminders', getErrorMessage(error));
    }
  };

  const cyclePermissionState = async (key: string, current: string) => {
    const next = current === 'granted' ? 'denied' : current === 'denied' ? 'not_requested' : 'granted';

    try {
      await onUpdatePermissionStates({
        [key]: next,
      });
    } catch (error) {
      Alert.alert('Unable to update permissions', getErrorMessage(error));
    }
  };

  return (
    <ScreenScaffold title="Settings">
      <AppScrollView contentContainerStyle={styles.scrollContent}>
        <SectionTitle title="Account" />
        <ActionCard onPress={onOpenProfile} subtitle="Update name, email, and contact details." title="Profile" />
        <ActionCard onPress={onOpenZones} subtitle="Manage charge zones and monitored routes." title="Saved zones" />
        <ActionCard onPress={onOpenSupport} subtitle="Help, privacy, terms, and export actions." title="Support & legal" />

        <SectionTitle title="Reminders" />
        <ToggleCard
          label="MOT reminders"
          onValueChange={(value) => void togglePreference('mot_enabled', value)}
          value={notificationPreferences?.mot_enabled ?? false}
        />
        <ToggleCard
          label="Tax reminders"
          onValueChange={(value) => void togglePreference('tax_enabled', value)}
          value={notificationPreferences?.tax_enabled ?? false}
        />
        <ToggleCard
          label="Insurance reminders"
          onValueChange={(value) => void togglePreference('insurance_enabled', value)}
          value={notificationPreferences?.insurance_enabled ?? false}
        />
        <ToggleCard
          label="Document reminders"
          onValueChange={(value) => void togglePreference('docs_enabled', value)}
          value={notificationPreferences?.docs_enabled ?? false}
        />
        <ToggleCard
          label="Zone reminders"
          onValueChange={(value) => void togglePreference('zones_enabled', value)}
          value={notificationPreferences?.zones_enabled ?? false}
        />

        <SectionTitle title="Permissions" />
        <ActionCard
          onPress={() => void cyclePermissionState('notifications_state', permissionStates?.notifications_state ?? 'not_requested')}
          subtitle={`State: ${prettyPermission(permissionStates?.notifications_state ?? 'not_requested')}`}
          title="Notifications"
        />
        <ActionCard
          onPress={() => void cyclePermissionState('camera_state', permissionStates?.camera_state ?? 'not_requested')}
          subtitle={`State: ${prettyPermission(permissionStates?.camera_state ?? 'not_requested')}`}
          title="Camera"
        />
        <ActionCard
          onPress={() => void cyclePermissionState('files_state', permissionStates?.files_state ?? 'not_requested')}
          subtitle={`State: ${prettyPermission(permissionStates?.files_state ?? 'not_requested')}`}
          title="Files"
        />
        <ActionCard
          onPress={() => void cyclePermissionState('biometrics_state', permissionStates?.biometrics_state ?? 'not_requested')}
          subtitle={`State: ${prettyPermission(permissionStates?.biometrics_state ?? 'not_requested')}`}
          title="Biometrics"
        />

        <PrimaryButton
          label="Sign Out"
          onPress={() =>
            Alert.alert('Sign out', 'Leave the current DriveReady session?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Sign out',
                style: 'destructive',
                onPress: () => {
                  void onSignOut();
                },
              },
            ])
          }
        />
      </AppScrollView>
    </ScreenScaffold>
  );
}

function AddVehicleScreen({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [registrationPlate, setRegistrationPlate] = useState('LS12 ABC');
  const [nickname, setNickname] = useState('Weekend Coupe');
  const [makeModel, setMakeModel] = useState('BMW 4 Series');
  const [fuelType, setFuelType] = useState('Petrol');
  const [mileage, setMileage] = useState('28500');
  const [motDueAt, setMotDueAt] = useState(dateInputFromNow(240));
  const [taxDueAt, setTaxDueAt] = useState(dateInputFromNow(120));
  const [insuranceDueAt, setInsuranceDueAt] = useState(dateInputFromNow(90));
  const [notes, setNotes] = useState('Used mainly for weekend trips.');

  const submit = async () => {
    if (!registrationPlate.trim() || !nickname.trim() || !makeModel.trim() || !fuelType.trim()) {
      Alert.alert('Missing vehicle details', 'Registration, name, make/model, and fuel type are required.');
      return;
    }

    try {
      await onSubmit({
        registration_plate: registrationPlate,
        nickname,
        make_model: makeModel,
        fuel_type: fuelType,
        mileage: Number(mileage),
        mot_due_at: motDueAt,
        tax_due_at: taxDueAt,
        insurance_due_at: insuranceDueAt,
        notes,
      });
    } catch (error) {
      Alert.alert('Unable to add vehicle', getErrorMessage(error));
    }
  };

  return (
    <FormScreen
      onBack={onBack}
      primaryActionLabel="Save vehicle"
      onPrimaryAction={() => {
        void submit();
      }}
      title="Add vehicle"
    >
      <InputField label="Registration" onChangeText={setRegistrationPlate} value={registrationPlate} />
      <InputField label="Vehicle name" onChangeText={setNickname} value={nickname} />
      <InputField label="Make / model" onChangeText={setMakeModel} value={makeModel} />
      <InputField label="Fuel type" onChangeText={setFuelType} value={fuelType} />
      <InputField keyboardType="numeric" label="Mileage" onChangeText={setMileage} value={mileage} />
      <InputField label="MOT due (YYYY-MM-DD)" onChangeText={setMotDueAt} value={motDueAt} />
      <InputField label="Tax due (YYYY-MM-DD)" onChangeText={setTaxDueAt} value={taxDueAt} />
      <InputField label="Insurance due (YYYY-MM-DD)" onChangeText={setInsuranceDueAt} value={insuranceDueAt} />
      <InputField label="Notes" multiline onChangeText={setNotes} value={notes} />
    </FormScreen>
  );
}

function VehicleDetailScreen({
  enrichVehicle,
  model,
  onBack,
  onEdit,
  onOpenDocument,
  onRunTripCheck,
  vehicleId,
}: {
  enrichVehicle: (vehicleId: string) => Promise<{ freshness_at: string; mot_tests_synced: number; source_name: string; vehicle: VehicleSummary }>;
  model: ReturnType<typeof useDriveReadyModel>;
  onBack: () => void;
  onEdit: () => void;
  onOpenDocument: (documentId: string) => void;
  onRunTripCheck: () => void;
  vehicleId: string;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof model.loadVehicleDetail>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshingVehicleData, setIsRefreshingVehicleData] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = () =>
      model
        .loadVehicleDetail(vehicleId)
        .then((response) => {
          if (alive) {
            setDetail(response);
            setError(null);
          }
        })
        .catch((caughtError) => {
          if (alive) {
            setError(getErrorMessage(caughtError));
          }
        });

    void load();

    return () => {
      alive = false;
    };
  }, [model, vehicleId]);

  if (!detail) {
    return <LoadingState label="Loading vehicle" detail={error ?? 'Fetching the latest vehicle details.'} onBack={onBack} />;
  }

  const vehicle = detail.vehicle;

  return (
    <ScreenScaffold actionIcon="edit" onActionPress={onEdit} onBack={onBack} title={vehicle.nickname}>
      <AppScrollView contentContainerStyle={styles.scrollContent}>
        <Image source={{ uri: vehicle.image_url }} style={styles.detailHeroImage} />
        <View style={styles.detailTopCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.detailTitle}>{vehicle.make_model}</Text>
            <StatusPill label={readinessLabel(vehicle.readiness_status)} tone={vehicle.readiness_tone} />
          </View>
          <Text style={styles.cardMeta}>{vehicle.registration_plate} · {vehicle.fuel_type} · {vehicle.mileage.toLocaleString()} miles</Text>
          <Text style={styles.cardBody}>{vehicle.notes}</Text>
        </View>

        <PrimaryButton
          label={isRefreshingVehicleData ? 'Refreshing vehicle data...' : 'Refresh vehicle data'}
          onPress={() => {
            if (isRefreshingVehicleData) {
              return;
            }

            setIsRefreshingVehicleData(true);
            void enrichVehicle(vehicle.id)
              .then(async (result) => {
                const refreshed = await model.loadVehicleDetail(vehicle.id);
                setDetail(refreshed);
                Alert.alert(
                  'Vehicle data updated',
                  result.mot_tests_synced > 0
                    ? `Synced ${result.mot_tests_synced} MOT test${result.mot_tests_synced === 1 ? '' : 's'} and refreshed vehicle data from ${result.source_name}.`
                    : `Refreshed vehicle data from ${result.source_name}.`,
                );
              })
              .catch((caughtError) => {
                Alert.alert('Unable to refresh vehicle data', getErrorMessage(caughtError));
              })
              .finally(() => {
                setIsRefreshingVehicleData(false);
              });
          }}
        />

        <SectionTitle actionLabel="Trip Check" onAction={onRunTripCheck} title="Road-readiness" />
        <View style={styles.summaryGrid}>
          <MetricCard label="MOT" tone={dateTone(vehicle.mot_due_at)} value={formatDate(vehicle.mot_due_at)} />
          <MetricCard label="Tax" tone={dateTone(vehicle.tax_due_at)} value={formatDate(vehicle.tax_due_at)} />
          <MetricCard label="Insurance" tone={dateTone(vehicle.insurance_due_at)} value={formatDate(vehicle.insurance_due_at)} />
        </View>

        {vehicle.dvsa_mot ? (
          <>
            <SectionTitle title="DVSA MOT" />
            <ListCard
              badge={vehicle.dvsa_mot.recall_status}
              body={`Checked ${formatDateTime(vehicle.dvsa_mot.checked_at)} · ${vehicle.dvsa_mot.test_count} test${vehicle.dvsa_mot.test_count === 1 ? '' : 's'} on record`}
              title={vehicle.dvsa_mot.last_test ? `Last result ${vehicle.dvsa_mot.last_test.test_result}` : 'No MOT tests yet'}
            />
          </>
        ) : null}

        {vehicle.dvla_ves ? (
          <>
            <SectionTitle title="DVLA vehicle data" />
            <ListCard
              badge={vehicle.dvla_ves.tax_status ?? 'Unknown tax'}
              body={`Checked ${formatDateTime(vehicle.dvla_ves.checked_at)}${vehicle.dvla_ves.tax_due_date ? ` · Tax due ${formatDate(vehicle.dvla_ves.tax_due_date)}` : ''}${vehicle.dvla_ves.colour ? ` · ${vehicle.dvla_ves.colour}` : ''}`}
              title={vehicle.dvla_ves.mot_status ? `MOT ${vehicle.dvla_ves.mot_status}` : 'Vehicle enquiry verified'}
            />
          </>
        ) : null}

        <SectionTitle title="Documents" />
        {detail.linked_documents.map((document) => (
          <ActionCard
            key={document.id}
            onPress={() => onOpenDocument(document.id)}
            subtitle={`${documentTypeLabel(document.document_type)} · ${formatDate(document.expires_at)}`}
            title={document.title}
          />
        ))}

        <SectionTitle title="Service history" />
        {detail.service_history.map((item) => (
          <ListCard key={item.id} body={item.note} title={`${formatDate(item.event_date)} · ${item.title}`} />
        ))}

        <SectionTitle title="Saved zones" />
        {detail.linked_zones.map((zone) => (
          <ListCard
            key={zone.id}
            badge={complianceLabel(zone.compliance_status)}
            body={`${zone.route_label} · ${zone.charge_amount_label}`}
            title={zone.name}
          />
        ))}
      </AppScrollView>
    </ScreenScaffold>
  );
}

function EditVehicleScreen({
  onBack,
  onDelete,
  onSubmit,
  vehicleId,
  vehicles,
}: {
  onBack: () => void;
  onDelete: (vehicleId: string) => Promise<void>;
  onSubmit: (vehicleId: string, payload: Record<string, unknown>) => Promise<void>;
  vehicleId: string;
  vehicles: VehicleSummary[];
}) {
  const vehicle = vehicles.find((entry) => entry.id === vehicleId);
  const [nickname, setNickname] = useState(vehicle?.nickname ?? '');
  const [makeModel, setMakeModel] = useState(vehicle?.make_model ?? '');
  const [fuelType, setFuelType] = useState(vehicle?.fuel_type ?? '');
  const [mileage, setMileage] = useState(String(vehicle?.mileage ?? ''));
  const [motDueAt, setMotDueAt] = useState(vehicle?.mot_due_at ?? '');
  const [taxDueAt, setTaxDueAt] = useState(vehicle?.tax_due_at ?? '');
  const [insuranceDueAt, setInsuranceDueAt] = useState(vehicle?.insurance_due_at ?? '');
  const [notes, setNotes] = useState(vehicle?.notes ?? '');

  if (!vehicle) {
    return <LoadingState label="Vehicle missing" detail="The selected vehicle could not be found." onBack={onBack} />;
  }

  return (
    <FormScreen
      destructiveActionLabel="Delete vehicle"
      onBack={onBack}
      onDestructiveAction={() =>
        Alert.alert('Delete vehicle', 'This removes the vehicle and linked data from DriveReady.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void onDelete(vehicle.id);
            },
          },
        ])
      }
      onPrimaryAction={() => {
        void onSubmit(vehicle.id, {
          nickname,
          make_model: makeModel,
          fuel_type: fuelType,
          mileage: Number(mileage),
          mot_due_at: motDueAt,
          tax_due_at: taxDueAt,
          insurance_due_at: insuranceDueAt,
          notes,
        }).catch((error) => {
          Alert.alert('Unable to update vehicle', getErrorMessage(error));
        });
      }}
      primaryActionLabel="Save changes"
      title="Edit vehicle"
    >
      <InputField editable={false} label="Registration" value={vehicle.registration_plate} />
      <InputField label="Vehicle name" onChangeText={setNickname} value={nickname} />
      <InputField label="Make / model" onChangeText={setMakeModel} value={makeModel} />
      <InputField label="Fuel type" onChangeText={setFuelType} value={fuelType} />
      <InputField keyboardType="numeric" label="Mileage" onChangeText={setMileage} value={mileage} />
      <InputField label="MOT due" onChangeText={setMotDueAt} value={motDueAt} />
      <InputField label="Tax due" onChangeText={setTaxDueAt} value={taxDueAt} />
      <InputField label="Insurance due" onChangeText={setInsuranceDueAt} value={insuranceDueAt} />
      <InputField label="Notes" multiline onChangeText={setNotes} value={notes} />
    </FormScreen>
  );
}

function AlertDetailScreen({
  alertId,
  loadAlert,
  onBack,
  onSave,
}: {
  alertId: string;
  loadAlert: ReturnType<typeof useDriveReadyModel>['loadAlert'];
  onBack: () => void;
  onSave: (alertId: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [alertItem, setAlertItem] = useState<AlertSummary | null>(null);
  const [leadDays, setLeadDays] = useState('14');
  const [muted, setMuted] = useState(false);
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    let alive = true;

    loadAlert(alertId)
      .then((result) => {
        if (!alive) {
          return;
        }

        setAlertItem(result.alert);
        setLeadDays(String(result.alert.lead_days));
        setMuted(result.alert.muted);
        setHandled(result.alert.handled);
      })
      .catch((error) => {
        if (alive) {
          Alert.alert('Unable to load alert', getErrorMessage(error));
        }
      });

    return () => {
      alive = false;
    };
  }, [alertId, loadAlert]);

  if (!alertItem) {
    return <LoadingState label="Loading alert" detail="Getting current reminder settings." onBack={onBack} />;
  }

  return (
    <FormScreen
      onBack={onBack}
      onPrimaryAction={() => {
        void onSave(alertItem.id, {
          lead_days: Number(leadDays),
          muted,
          handled,
        }).catch((error) => {
          Alert.alert('Unable to save alert', getErrorMessage(error));
        });
      }}
      primaryActionLabel="Save reminder"
      title="Alert detail"
    >
      <ListCard badge={alertToneLabel(alertItem.tone)} body={alertItem.detail} title={alertItem.title} />
      <InputField keyboardType="numeric" label="Lead time (days)" onChangeText={setLeadDays} value={leadDays} />
      <ToggleCard label="Mute reminder" onValueChange={setMuted} value={muted} />
      <ToggleCard label="Mark handled" onValueChange={setHandled} value={handled} />
    </FormScreen>
  );
}

function UploadDocumentScreen({
  initialVehicleId,
  onBack,
  onSubmit,
  vehicles,
}: {
  initialVehicleId?: string;
  onBack: () => void;
  onSubmit: (payload: Record<string, unknown>, asset?: LocalUploadAsset) => Promise<void>;
  vehicles: VehicleSummary[];
}) {
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? vehicles[0]?.id ?? '');
  const [title, setTitle] = useState('New insurance file');
  const [documentType, setDocumentType] = useState<'mot' | 'insurance' | 'v5c' | 'service'>('insurance');
  const [sourceType, setSourceType] = useState<'camera' | 'files' | 'email'>('files');
  const [expiresAt, setExpiresAt] = useState(dateInputFromNow(180));
  const [asset, setAsset] = useState<LocalUploadAsset | null>(null);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ['application/pdf', 'image/*'],
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const picked = result.assets[0];
    setAsset({
      uri: picked.uri,
      name: picked.name,
      mimeType: picked.mimeType,
    });
  };

  return (
    <FormScreen
      onBack={onBack}
      onPrimaryAction={() => {
        void onSubmit({
          vehicle_id: vehicleId,
          title,
          document_type: documentType,
          source_type: sourceType,
          expires_at: expiresAt,
          file_name: asset?.name ?? `${title.toLowerCase().replace(/\s+/g, '-')}.pdf`,
        }, asset ?? undefined).catch((error) => {
          Alert.alert('Unable to upload document', getErrorMessage(error));
        });
      }}
      primaryActionLabel="Save document"
      title="Upload document"
    >
      <SelectionField
        label="Vehicle"
        onSelect={setVehicleId}
        options={vehicles.map((vehicle) => ({
          key: vehicle.id,
          label: `${vehicle.nickname} · ${vehicle.registration_plate}`,
        }))}
        selected={vehicleId}
      />
      <InputField label="Title" onChangeText={setTitle} value={title} />
      <SelectionField
        label="Document type"
        onSelect={(value) => setDocumentType(value as typeof documentType)}
        options={[
          { key: 'mot', label: 'MOT' },
          { key: 'insurance', label: 'Insurance' },
          { key: 'v5c', label: 'V5C' },
          { key: 'service', label: 'Service' },
        ]}
        selected={documentType}
      />
      <SelectionField
        label="Source"
        onSelect={(value) => setSourceType(value as typeof sourceType)}
        options={[
          { key: 'files', label: 'Files' },
          { key: 'camera', label: 'Camera' },
          { key: 'email', label: 'Email' },
        ]}
        selected={sourceType}
      />
      <InputField label="Expiry date" onChangeText={setExpiresAt} value={expiresAt} />
      <ActionCard
        onPress={() => {
          void pickFile().catch((error) => {
            Alert.alert('Unable to pick file', getErrorMessage(error));
          });
        }}
        subtitle={asset ? asset.name : 'Pick a PDF or image to upload with this document.'}
        title={asset ? 'Replace selected file' : 'Choose file'}
      />
    </FormScreen>
  );
}

function DocumentDetailScreen({
  documentId,
  loadDocument,
  onBack,
  onDelete,
  onReplaceFile,
  onSave,
  onShare,
}: {
  documentId: string;
  loadDocument: ReturnType<typeof useDriveReadyModel>['loadDocument'];
  onBack: () => void;
  onDelete: (documentId: string) => Promise<void>;
  onReplaceFile: (documentId: string, asset: LocalUploadAsset) => Promise<void>;
  onSave: (documentId: string, payload: Record<string, unknown>) => Promise<void>;
  onShare: (documentId: string) => Promise<{ share_url: string }>;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadDocument>> | null>(null);
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  useEffect(() => {
    let alive = true;

    loadDocument(documentId)
      .then((result) => {
        if (!alive) {
          return;
        }

        setDetail(result);
        setTitle(result.document.title);
        setExpiresAt(result.document.expires_at);
      })
      .catch((error) => {
        if (alive) {
          Alert.alert('Unable to load document', getErrorMessage(error));
        }
      });

    return () => {
      alive = false;
    };
  }, [documentId, loadDocument]);

  if (!detail) {
    return <LoadingState label="Loading document" detail="Fetching document metadata." onBack={onBack} />;
  }

  const { document, linked_vehicle } = detail;

  return (
    <FormScreen
      destructiveActionLabel="Delete document"
      onBack={onBack}
      onDestructiveAction={() =>
        Alert.alert('Delete document', 'This removes the document from DriveReady.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void onDelete(document.id).catch((error) => {
                Alert.alert('Unable to delete document', getErrorMessage(error));
              });
            },
          },
        ])
      }
      onPrimaryAction={() => {
        void onSave(document.id, {
          title,
          expires_at: expiresAt,
        }).catch((error) => {
          Alert.alert('Unable to update document', getErrorMessage(error));
        });
      }}
      primaryActionLabel="Save changes"
      title="Document detail"
    >
      <ListCard badge={documentStatusLabel(document.status)} body={`${linked_vehicle.nickname} · ${document.file_name}`} title={document.title} />
      <InputField label="Title" onChangeText={setTitle} value={title} />
      <InputField label="Expiry date" onChangeText={setExpiresAt} value={expiresAt} />
      <ActionCard
        onPress={() => {
          void DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
            multiple: false,
            type: ['application/pdf', 'image/*'],
          })
            .then((result) => {
              if (result.canceled || !result.assets[0]) {
                return;
              }

              return onReplaceFile(document.id, {
                uri: result.assets[0].uri,
                name: result.assets[0].name,
                mimeType: result.assets[0].mimeType,
              });
            })
            .then(() => {
              Alert.alert('File replaced', 'The document file was replaced on the backend.');
            })
            .catch((error) => {
              Alert.alert('Unable to replace file', getErrorMessage(error));
            });
        }}
        subtitle={document.file_name}
        title="Replace file"
      />
      <ActionCard
        onPress={() => {
          void onShare(document.id)
            .then((result) => {
              Alert.alert('Share link created', result.share_url);
            })
            .catch((error) => {
              Alert.alert('Unable to share', getErrorMessage(error));
            });
        }}
        subtitle="Generate a temporary share link from the backend."
        title="Share document"
      />
    </FormScreen>
  );
}

function TripCheckScreen({
  onBack,
  onRunTripCheck,
  tripChecks,
  vehicles,
  zones,
}: {
  onBack: () => void;
  onRunTripCheck: (payload: Record<string, unknown>) => Promise<ReturnType<typeof useDriveReadyModel>['tripChecks'][number]>;
  tripChecks: ReturnType<typeof useDriveReadyModel>['tripChecks'];
  vehicles: VehicleSummary[];
  zones: SavedZone[];
}) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [mode, setMode] = useState<'destination' | 'saved_zone'>('destination');
  const [destination, setDestination] = useState('Shoreditch High Street, London');
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
  const [result, setResult] = useState<ReturnType<typeof useDriveReadyModel>['tripChecks'][number] | null>(null);
  const [destinationSuggestions, setDestinationSuggestions] = useState<DestinationSuggestion[]>([]);
  const [isSearchingDestinations, setIsSearchingDestinations] = useState(false);
  const [destinationSearchError, setDestinationSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'destination') {
      setDestinationSuggestions([]);
      setDestinationSearchError(null);
      setIsSearchingDestinations(false);
      return;
    }

    const trimmedDestination = destination.trim();

    if (trimmedDestination.length < 3 || !hasMapboxToken()) {
      setDestinationSuggestions([]);
      setDestinationSearchError(null);
      setIsSearchingDestinations(false);
      return;
    }

    let cancelled = false;
    setIsSearchingDestinations(true);
    setDestinationSearchError(null);

    const timeoutId = setTimeout(() => {
      void searchDestinationSuggestions(trimmedDestination)
        .then((suggestions) => {
          if (cancelled) {
            return;
          }

          setDestinationSuggestions(suggestions);
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          setDestinationSuggestions([]);
          setDestinationSearchError('Live destination suggestions are temporarily unavailable.');
        })
        .finally(() => {
          if (!cancelled) {
            setIsSearchingDestinations(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [destination, mode]);

  const runCheck = async () => {
    if (!vehicleId || (mode === 'destination' && !destination.trim()) || (mode === 'saved_zone' && !zoneId)) {
      Alert.alert('Missing Trip Check details', 'Select a vehicle and enter a destination or choose a saved zone.');
      return;
    }

    try {
      const tripCheck = await onRunTripCheck({
        vehicle_id: vehicleId,
        input_type: mode,
        destination_query: mode === 'destination' ? destination : undefined,
        saved_zone_id: mode === 'saved_zone' ? zoneId : undefined,
        persist_result: true,
      });
      setResult(tripCheck);
    } catch (error) {
      Alert.alert('Unable to run Trip Check', getErrorMessage(error));
    }
  };

  return (
    <FormScreen
      onBack={onBack}
      onPrimaryAction={() => {
        void runCheck();
      }}
      primaryActionLabel="Run Trip Check"
      title="Trip Check"
    >
      <SelectionField
        label="Vehicle"
        onSelect={setVehicleId}
        options={vehicles.map((vehicle) => ({
          key: vehicle.id,
          label: `${vehicle.nickname} · ${vehicle.registration_plate}`,
        }))}
        selected={vehicleId}
      />
      <SegmentControl
        options={[
          { key: 'destination', label: 'Destination' },
          { key: 'saved_zone', label: 'Saved zone' },
        ]}
        selected={mode}
        onSelect={(value) => setMode(value as 'destination' | 'saved_zone')}
      />
      {mode === 'destination' ? (
        <View style={styles.destinationInputStack}>
          <InputField
            label="Destination"
            onChangeText={(value) => {
              setDestination(value);
              setResult(null);
            }}
            value={destination}
          />
          {hasMapboxToken() ? (
            <Text style={styles.fieldHelperText}>Suggestions powered by Mapbox</Text>
          ) : null}
          {isSearchingDestinations ? (
            <Text style={styles.fieldStatusText}>Searching destinations…</Text>
          ) : null}
          {destinationSearchError ? (
            <Text style={styles.fieldErrorText}>{destinationSearchError}</Text>
          ) : null}
          {destinationSuggestions.length > 0 ? (
            <View style={styles.suggestionList}>
              {destinationSuggestions.map((suggestion) => (
                <Pressable
                  key={suggestion.id}
                  onPress={() => {
                    setDestination(suggestion.label);
                    setDestinationSuggestions([]);
                    setDestinationSearchError(null);
                    setResult(null);
                  }}
                  style={({ pressed }) => [styles.suggestionCard, pressed && styles.pressed]}
                >
                  <Text style={styles.suggestionTitle}>{suggestion.label}</Text>
                  {suggestion.secondaryLabel ? (
                    <Text style={styles.suggestionMeta}>{suggestion.secondaryLabel}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <SelectionField
          label="Saved zone"
          onSelect={setZoneId}
          options={zones.map((zone) => ({
            key: zone.id,
            label: `${zone.name} · ${zone.route_label}`,
          }))}
          selected={zoneId}
        />
      )}

      {result ? (
        <View style={styles.resultStack}>
          <ListCard
            badge={complianceLabel(result.compliance_status)}
            body={`Charge estimate: ${result.charge_amount_label} · Confidence ${result.confidence_label}`}
            title={mode === 'destination' ? result.destination_query ?? 'Trip result' : 'Saved zone result'}
          />
          {result.parking_suggestions.map((parking) => (
            <ParkingCard key={parking.id} parking={parking} />
          ))}
        </View>
      ) : null}

      <SectionTitle title="Recent Trip Checks" />
      {tripChecks.length === 0 ? (
        <ListCard body="Run a trip check to save recent compliance and parking results." title="No Trip Check history" />
      ) : (
        tripChecks.slice(0, 4).map((tripCheck) => (
          <ListCard
            key={tripCheck.id}
            badge={complianceLabel(tripCheck.compliance_status)}
            body={`${tripCheck.charge_amount_label} · ${formatDateTime(tripCheck.freshness_at)}`}
            title={
              tripCheck.destination_query ??
              zones.find((zone) => zone.id === tripCheck.saved_zone_id)?.name ??
              'Saved zone'
            }
          />
        ))
      )}
    </FormScreen>
  );
}

function SavedZonesScreen({
  onBack,
  onCreateZone,
  onDeleteZone,
  onUpdateZone,
  zones,
}: {
  onBack: () => void;
  onCreateZone: (payload: Record<string, unknown>) => Promise<void>;
  onDeleteZone: (zoneId: string) => Promise<void>;
  onUpdateZone: (zoneId: string, payload: Record<string, unknown>) => Promise<void>;
  zones: SavedZone[];
}) {
  const [name, setName] = useState('Manchester CAZ');
  const [routeLabel, setRouteLabel] = useState('Client site');
  const [chargeLabel, setChargeLabel] = useState('£10.00 daily charge');

  return (
    <ScreenScaffold onBack={onBack} title="Saved zones">
      <AppScrollView contentContainerStyle={styles.scrollContent}>
        {zones.map((zone) => (
          <View key={zone.id} style={styles.zoneCard}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{zone.name}</Text>
              <Text style={styles.cardMeta}>{zone.route_label} · {zone.charge_amount_label}</Text>
            </View>
            <View style={styles.zoneActions}>
              <Switch
                onValueChange={(value) => {
                  void onUpdateZone(zone.id, { monitored: value }).catch((error) => {
                    Alert.alert('Unable to update zone', getErrorMessage(error));
                  });
                }}
                trackColor={{ false: theme.colors.surfaceHigh, true: theme.colors.iosBlue }}
                value={zone.monitored}
              />
              <Pressable
                onPress={() =>
                  Alert.alert('Delete zone', `Remove ${zone.name} from DriveReady?`, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => {
                        void onDeleteZone(zone.id).catch((error) => {
                          Alert.alert('Unable to delete zone', getErrorMessage(error));
                        });
                      },
                    },
                  ])
                }
                style={styles.deleteZoneButton}
              >
                <Text style={styles.deleteZoneLabel}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <SectionTitle title="Add zone" />
        <InputField label="Zone name" onChangeText={setName} value={name} />
        <InputField label="Route label" onChangeText={setRouteLabel} value={routeLabel} />
        <InputField label="Charge label" onChangeText={setChargeLabel} value={chargeLabel} />
        <PrimaryButton
          label="Save zone"
          onPress={() => {
            if (!name.trim() || !routeLabel.trim() || !chargeLabel.trim()) {
              Alert.alert('Missing zone details', 'Enter the zone name, route label, and charge amount.');
              return;
            }

            void onCreateZone({
              name,
              route_label: routeLabel,
              charge_amount_label: chargeLabel,
            }).catch((error) => {
              Alert.alert('Unable to create zone', getErrorMessage(error));
            });
          }}
        />
      </AppScrollView>
    </ScreenScaffold>
  );
}

function ProfileScreen({
  onBack,
  onSubmit,
  user,
}: {
  onBack: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  user: ReturnType<typeof useDriveReadyModel>['user'];
}) {
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [address, setAddress] = useState(user?.address_line ?? '');

  return (
    <FormScreen
      onBack={onBack}
      onPrimaryAction={() => {
        void onSubmit({
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          address_line: address,
        }).catch((error) => {
          Alert.alert('Unable to update profile', getErrorMessage(error));
        });
      }}
      primaryActionLabel="Save profile"
      title="Profile"
    >
      <InputField label="First name" onChangeText={setFirstName} value={firstName} />
      <InputField label="Last name" onChangeText={setLastName} value={lastName} />
      <InputField label="Email" onChangeText={setEmail} value={email} />
      <InputField label="Phone" onChangeText={setPhone} value={phone} />
      <InputField label="Address" multiline onChangeText={setAddress} value={address} />
    </FormScreen>
  );
}

function SupportScreen({
  items,
  onBack,
  onExportRequest,
}: {
  items: SupportItem[];
  onBack: () => void;
  onExportRequest: () => Promise<void>;
}) {
  return (
    <ScreenScaffold onBack={onBack} title="Support & legal">
      <AppScrollView contentContainerStyle={styles.scrollContent}>
        {items.map((item) => (
          <ListCard key={item.id} body={item.body} title={item.title} />
        ))}
        <PrimaryButton
          label="Request data export"
          onPress={() => {
            void onExportRequest()
              .then(() => {
                Alert.alert('Export requested', 'A backend export request has been queued.');
              })
              .catch((error) => {
                Alert.alert('Unable to request export', getErrorMessage(error));
              });
          }}
        />
      </AppScrollView>
    </ScreenScaffold>
  );
}

function ScreenScaffold({
  actionIcon,
  children,
  onActionPress,
  onBack,
  title,
}: PropsWithChildren<{
  actionIcon?: keyof typeof MaterialIcons.glyphMap;
  onActionPress?: () => void;
  onBack?: () => void;
  title: string;
}>) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topBarEdge}>
          {onBack ? <IconButton icon="arrow-back" onPress={onBack} /> : null}
        </View>
        <Text style={styles.topBarTitle}>{title}</Text>
        <View style={styles.topBarEdge}>
          {actionIcon && onActionPress ? <IconButton icon={actionIcon} onPress={onActionPress} /> : null}
        </View>
      </View>
      <View style={styles.flex}>{children}</View>
    </SafeAreaView>
  );
}

function AppScrollView({
  children,
  contentContainerStyle,
}: PropsWithChildren<{
  contentContainerStyle: StyleProp<ViewStyle>;
}>) {
  return (
    <ScrollView
      alwaysBounceVertical
      bounces
      canCancelContentTouches
      contentContainerStyle={contentContainerStyle}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      scrollEnabled
      showsVerticalScrollIndicator
      style={styles.flex}
    >
      {children}
    </ScrollView>
  );
}

function FormScreen({
  children,
  destructiveActionLabel,
  onBack,
  onDestructiveAction,
  onPrimaryAction,
  primaryActionLabel,
  title,
}: PropsWithChildren<{
  destructiveActionLabel?: string;
  onBack: () => void;
  onDestructiveAction?: () => void;
  onPrimaryAction: () => void;
  primaryActionLabel: string;
  title: string;
}>) {
  return (
    <ScreenScaffold onBack={onBack} title={title}>
      <AppScrollView contentContainerStyle={styles.formScrollContent}>
        {children}
        <PrimaryButton label={primaryActionLabel} onPress={onPrimaryAction} />
        {destructiveActionLabel && onDestructiveAction ? (
          <SecondaryButton label={destructiveActionLabel} onPress={onDestructiveAction} />
        ) : null}
      </AppScrollView>
    </ScreenScaffold>
  );
}

function AuthScaffold({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.authScreen}>
      <StatusBar style="dark" />
      <AppScrollView
        contentContainerStyle={[
          styles.authScrollContent,
          {
            paddingBottom: Math.max(insets.bottom + theme.spacing[6], theme.spacing[8]),
            paddingTop: theme.spacing[6],
          },
        ]}
      >
        <View style={styles.authContainer}>{children}</View>
      </AppScrollView>
    </SafeAreaView>
  );
}

function AuthCard({
  body,
  children,
  title,
}: PropsWithChildren<{
  body: string;
  title: string;
}>) {
  return (
    <View style={styles.authCardWrap}>
      <Text style={styles.authTitle}>{title}</Text>
      <Text style={styles.authBody}>{body}</Text>
      <View style={styles.formCard}>{children}</View>
    </View>
  );
}

function KeyboardScaffold({ children }: PropsWithChildren) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.authScreen}
    >
      <AuthScaffold>{children}</AuthScaffold>
    </KeyboardAvoidingView>
  );
}

function LoadingState({
  detail,
  label,
  onBack,
}: {
  detail: string;
  label: string;
  onBack?: () => void;
}) {
  return (
    <SafeAreaView style={styles.loadingScreen}>
      {onBack ? <BackButton onPress={onBack} /> : null}
      <View style={styles.loadingCenter}>
        <View style={styles.heroIconWrap}>
          <MaterialIcons color={theme.colors.primary} name="directions-car" size={34} />
        </View>
        <Text style={styles.authTitle}>{label}</Text>
        <Text style={styles.authBody}>{detail}</Text>
      </View>
    </SafeAreaView>
  );
}

function ConnectionErrorState({
  detail,
  onRetry,
}: {
  detail: string;
  onRetry: () => void;
}) {
  return (
    <SafeAreaView style={styles.loadingScreen}>
      <View style={styles.loadingCenter}>
        <Text style={styles.authTitle}>Backend not available</Text>
        <Text style={styles.authBody}>{detail}</Text>
        <ListCard
          body="Start the local API at backend/ and then retry. The app now expects a real service layer instead of the old hardcoded prototype state."
          title="What changed"
        />
        <PrimaryButton label="Retry connection" onPress={onRetry} />
      </View>
    </SafeAreaView>
  );
}

function EmptyStateScreen({
  actionLabel,
  body,
  onAction,
  title,
}: {
  actionLabel: string;
  body: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <ScreenScaffold title="DriveReady UK">
      <View style={styles.emptyStateWrap}>
        <Text style={styles.authTitle}>{title}</Text>
        <Text style={styles.authBody}>{body}</Text>
        <PrimaryButton label={actionLabel} onPress={onAction} />
      </View>
    </ScreenScaffold>
  );
}

function HeroVehicleCard({ onPress, vehicle }: { onPress: () => void; vehicle: VehicleSummary }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.heroVehicleCard, pressed && styles.pressed]}>
      <Image source={{ uri: vehicle.image_url }} style={styles.heroVehicleImage} />
      <View style={styles.heroOverlay} />
      <View style={styles.heroContent}>
        <StatusPill label={complianceLabel(vehicle.compliance_status)} tone={vehicle.compliance_status === 'charge_risk' ? 'warning' : 'good'} />
        <Text style={styles.heroTitle}>{vehicle.nickname}</Text>
        <Text style={styles.heroSubtitle}>{vehicle.make_model}</Text>
        <Text style={styles.heroMeta}>{vehicle.registration_plate} · {readinessLabel(vehicle.readiness_status)}</Text>
      </View>
    </Pressable>
  );
}

function SectionTitle({
  actionLabel,
  onAction,
  title,
}: {
  actionLabel?: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction}>
          <Text style={styles.textLink}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MetricCard({ label, tone, value }: { label: string; tone: 'good' | 'warning' | 'critical'; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <View style={[styles.metricDot, tone === 'good' ? styles.goodFill : tone === 'warning' ? styles.warningFill : styles.criticalFill]} />
    </View>
  );
}

function QuickActionCard({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickActionCard, pressed && styles.pressed]}>
      <MaterialIcons color={theme.colors.iosBlue} name={icon} size={22} />
      <Text style={styles.quickActionLabel}>{label}</Text>
    </Pressable>
  );
}

function ActionCard({
  onPress,
  subtitle,
  title,
}: {
  onPress: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.listCard, pressed && styles.pressed]}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{subtitle}</Text>
    </Pressable>
  );
}

function ListCard({
  badge,
  body,
  title,
}: {
  badge?: string;
  body: string;
  title: string;
}) {
  return (
    <View style={styles.listCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{title}</Text>
        {badge ? <MiniPill label={badge} /> : null}
      </View>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function ParkingCard({ parking }: { parking: ParkingSuggestion }) {
  return (
    <View style={styles.listCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{parking.label}</Text>
        <MiniPill label={parking.is_free ? 'Free' : parking.price_band} />
      </View>
      <Text style={styles.cardBody}>{parking.restriction_note}</Text>
      <Text style={styles.cardMeta}>{parking.walking_distance_meters}m walk · {parking.confidence_label} confidence</Text>
    </View>
  );
}

function ToggleCard({
  label,
  onValueChange,
  value,
}: {
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.toggleCard}>
      <Text style={styles.cardTitle}>{label}</Text>
      <Switch onValueChange={onValueChange} trackColor={{ false: theme.colors.surfaceHigh, true: theme.colors.iosBlue }} value={value} />
    </View>
  );
}

function FeatureCard({
  body,
  icon,
  title,
}: {
  body: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.featureCard}>
      <MaterialIcons color={theme.colors.iosBlue} name={icon} size={22} />
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function InputField({
  editable = true,
  keyboardType,
  label,
  multiline = false,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  value,
}: {
  editable?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  label: string;
  multiline?: boolean;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  value: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.outlineVariant}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline && styles.inputMultiline, !editable && styles.inputDisabled]}
        value={value}
      />
    </View>
  );
}

function SelectionField({
  label,
  onSelect,
  options,
  selected,
}: {
  label: string;
  onSelect: (key: string) => void;
  options: Array<{ key: string; label: string }>;
  selected: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.segmentWrap}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            style={({ pressed }) => [
              styles.segmentOption,
              selected === option.key && styles.segmentOptionActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.segmentLabel, selected === option.key && styles.segmentLabelActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SegmentControl({
  onSelect,
  options,
  selected,
}: {
  onSelect: (key: string) => void;
  options: Array<{ key: string; label: string }>;
  selected: string;
}) {
  return (
    <View style={styles.segmentControl}>
      {options.map((option) => (
        <Pressable
          key={option.key}
          onPress={() => onSelect(option.key)}
          style={({ pressed }) => [
            styles.segmentPill,
            selected === option.key && styles.segmentPillActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.segmentLabel, selected === option.key && styles.segmentLabelActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
      <Text style={styles.primaryButtonLabel}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  icon,
  label,
  onPress,
}: {
  icon?: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
      {icon ? <MaterialIcons color={theme.colors.text} name={icon} size={18} /> : null}
      <Text style={styles.secondaryButtonLabel}>{label}</Text>
    </Pressable>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.backButtonWrap}>
      <IconButton icon="arrow-back" onPress={onPress} />
    </View>
  );
}

function IconButton({
  icon,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <MaterialIcons color={theme.colors.text} name={icon} size={22} />
    </Pressable>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'good' | 'warning' | 'critical';
}) {
  return (
    <View
      style={[
        styles.statusPill,
        tone === 'good' ? styles.goodSoft : tone === 'warning' ? styles.warningSoft : styles.criticalSoft,
      ]}
    >
      <Text style={styles.statusPillLabel}>{label}</Text>
    </View>
  );
}

function MiniPill({ label }: { label: string }) {
  return (
    <View style={styles.miniPill}>
      <Text style={styles.miniPillLabel}>{label}</Text>
    </View>
  );
}

function TabBar({
  activeTab,
  bottomInset,
  onTabChange,
}: {
  activeTab: AppTab;
  bottomInset: number;
  onTabChange: (tab: AppTab) => void;
}) {
  const tabs: Array<{ tab: AppTab; label: string; icon: keyof typeof MaterialIcons.glyphMap }> = [
    { tab: 'home', label: 'Home', icon: 'home' },
    { tab: 'garage', label: 'Garage', icon: 'directions-car' },
    { tab: 'alerts', label: 'Alerts', icon: 'notifications' },
    { tab: 'docs', label: 'Docs', icon: 'description' },
    { tab: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <View style={[styles.tabBar, { paddingBottom: bottomInset + 12 }]}>
      {tabs.map((item) => (
        <Pressable key={item.tab} onPress={() => onTabChange(item.tab)} style={styles.tabBarItem}>
          <MaterialIcons color={activeTab === item.tab ? theme.colors.iosBlue : theme.colors.textMuted} name={item.icon} size={22} />
          <Text style={[styles.tabBarLabel, activeTab === item.tab && styles.tabBarLabelActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function dateInputFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateTone(value: string): 'good' | 'warning' | 'critical' {
  const days = daysUntil(value);

  if (days < 0) {
    return 'critical';
  }

  if (days <= 21) {
    return 'warning';
  }

  return 'good';
}

function daysUntil(value: string) {
  const today = new Date();
  const target = new Date(value);
  const utcOne = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const utcTwo = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((utcTwo - utcOne) / (24 * 60 * 60 * 1000));
}

function readinessLabel(status: 'ready' | 'attention' | 'urgent') {
  if (status === 'urgent') {
    return 'Urgent';
  }

  if (status === 'attention') {
    return 'Needs attention';
  }

  return 'Ready';
}

function documentStatusLabel(status: DocumentStatus) {
  if (status === 'needs_review') {
    return 'Needs review';
  }

  return status === 'expired' ? 'Expired' : 'Current';
}

function documentTypeLabel(type: DocumentSummary['document_type']) {
  if (type === 'v5c') {
    return 'V5C logbook';
  }

  if (type === 'mot') {
    return 'MOT certificate';
  }

  return type === 'insurance' ? 'Insurance file' : 'Service record';
}

function documentTone(status: DocumentStatus): 'good' | 'warning' | 'critical' {
  if (status === 'expired') {
    return 'critical';
  }

  return status === 'needs_review' ? 'warning' : 'good';
}

function complianceLabel(status: ComplianceStatus) {
  if (status === 'charge_risk') {
    return 'Charge risk';
  }

  if (status === 'unknown') {
    return 'Check required';
  }

  return 'Compliant';
}

function alertToneLabel(tone: 'good' | 'warning' | 'critical') {
  if (tone === 'critical') {
    return 'Urgent';
  }

  if (tone === 'warning') {
    return 'Soon';
  }

  return 'Good';
}

function prettyPermission(state: string) {
  if (state === 'not_requested') {
    return 'Not requested';
  }

  return state.charAt(0).toUpperCase() + state.slice(1);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

const styles = StyleSheet.create({
  authBody: {
    ...typeRamp.bodyLg,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  authButtonStack: {
    gap: theme.spacing[3],
    paddingTop: theme.spacing[2],
    width: '100%',
  },
  authCardWrap: {
    alignItems: 'center',
    gap: theme.spacing[4],
    width: '100%',
  },
  authContainer: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flexGrow: 1,
    gap: theme.spacing[6],
    paddingHorizontal: theme.spacing[6],
    width: '100%',
  },
  authScrollContent: {
    flexGrow: 1,
  },
  authDisplay: {
    ...typeRamp.display,
    fontSize: 44,
    lineHeight: 48,
    textAlign: 'center',
  },
  authScreen: {
    backgroundColor: theme.colors.background,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  authTitle: {
    ...typeRamp.headline,
    textAlign: 'center',
  },
  backButtonWrap: {
    alignSelf: 'flex-start',
  },
  cardBody: {
    ...typeRamp.body,
    color: theme.colors.textMuted,
  },
  cardMeta: {
    ...typeRamp.body,
    color: theme.colors.outline,
  },
  cardTitle: {
    ...typeRamp.title,
    fontSize: 18,
    lineHeight: 22,
  },
  criticalFill: {
    backgroundColor: theme.colors.error,
  },
  criticalSoft: {
    backgroundColor: 'rgba(159, 64, 61, 0.12)',
  },
  detailHeroImage: {
    borderRadius: theme.radius.lg,
    height: 220,
    width: '100%',
  },
  detailTitle: {
    ...typeRamp.headline,
    fontSize: 28,
    lineHeight: 32,
  },
  detailTopCard: {
    ...ghostBorder(0.2),
    ...shadows.card,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  emptyStateWrap: {
    alignItems: 'center',
    flex: 1,
    gap: theme.spacing[4],
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[6],
  },
  featureCard: {
    ...ghostBorder(0.2),
    ...shadows.soft,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  featureStack: {
    gap: theme.spacing[3],
    width: '100%',
  },
  flex: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  formCard: {
    ...ghostBorder(0.2),
    ...shadows.card,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    width: '100%',
  },
  formScrollContent: {
    gap: theme.spacing[4],
    padding: theme.spacing[5],
    paddingBottom: theme.spacing[10],
  },
  goodFill: {
    backgroundColor: theme.colors.tertiary,
  },
  goodSoft: {
    backgroundColor: 'rgba(0, 109, 74, 0.12)',
  },
  heroContent: {
    bottom: theme.spacing[4],
    gap: theme.spacing[1],
    left: theme.spacing[4],
    position: 'absolute',
    right: theme.spacing[4],
  },
  heroIconWrap: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.full,
    height: 84,
    justifyContent: 'center',
    marginBottom: theme.spacing[5],
    width: 84,
  },
  heroImage: {
    borderRadius: theme.radius.lg,
    height: '100%',
    width: '100%',
  },
  heroImageCard: {
    ...shadows.card,
    borderRadius: theme.radius.lg,
    height: 260,
    marginTop: theme.spacing[6],
    overflow: 'hidden',
    width: '100%',
  },
  heroMeta: {
    ...typeRamp.body,
    color: theme.colors.white,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 19, 20, 0.28)',
  },
  heroSubtitle: {
    ...typeRamp.bodyLg,
    color: theme.colors.white,
  },
  heroTitle: {
    ...typeRamp.headline,
    color: theme.colors.white,
    fontSize: 30,
    lineHeight: 34,
  },
  heroVehicleCard: {
    ...shadows.card,
    borderRadius: theme.radius.xl,
    height: 300,
    overflow: 'hidden',
    width: '100%',
  },
  heroVehicleImage: {
    height: '100%',
    width: '100%',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.full,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  inlineCenter: {
    alignItems: 'center',
  },
  input: {
    ...typeRamp.body,
    ...ghostBorder(0.2),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    minHeight: 52,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  inputDisabled: {
    color: theme.colors.outline,
  },
  inputGroup: {
    gap: theme.spacing[2],
  },
  destinationInputStack: {
    gap: theme.spacing[2],
  },
  fieldErrorText: {
    ...typeRamp.body,
    color: theme.colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  fieldHelperText: {
    ...typeRamp.body,
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  inputLabel: {
    ...typeRamp.eyebrow,
    color: theme.colors.textMuted,
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  listCard: {
    ...ghostBorder(0.16),
    ...shadows.soft,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  loadingCenter: {
    alignItems: 'center',
    gap: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
  },
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[6],
  },
  metricCard: {
    ...ghostBorder(0.16),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    gap: theme.spacing[2],
    minWidth: '31%',
    padding: theme.spacing[4],
  },
  metricDot: {
    borderRadius: theme.radius.full,
    height: 8,
    marginTop: theme.spacing[1],
    width: 28,
  },
  metricLabel: {
    ...typeRamp.eyebrow,
    color: theme.colors.textMuted,
  },
  metricValue: {
    ...typeRamp.title,
    fontSize: 18,
  },
  miniPill: {
    backgroundColor: theme.colors.surfaceLow,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  miniPillLabel: {
    ...typeRamp.body,
    fontSize: 12,
    lineHeight: 14,
  },
  pressed: {
    opacity: 0.78,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.text,
    borderRadius: theme.radius.full,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: theme.spacing[4],
  },
  primaryButtonLabel: {
    ...typeRamp.body,
    color: theme.colors.white,
    fontWeight: '700',
  },
  quickActionCard: {
    ...ghostBorder(0.16),
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    gap: theme.spacing[2],
    minHeight: 94,
    justifyContent: 'center',
    padding: theme.spacing[3],
    width: '23%',
  },
  quickActionLabel: {
    ...typeRamp.body,
    fontSize: 12,
    lineHeight: 15,
    textAlign: 'center',
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  resultStack: {
    gap: theme.spacing[3],
  },
  fieldStatusText: {
    ...typeRamp.body,
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing[2],
    justifyContent: 'space-between',
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  screenEyebrow: {
    ...typeRamp.eyebrow,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  scrollContent: {
    gap: theme.spacing[4],
    padding: theme.spacing[5],
    paddingBottom: 120,
  },
  suggestionCard: {
    ...ghostBorder(0.12),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  suggestionList: {
    gap: theme.spacing[2],
  },
  suggestionMeta: {
    ...typeRamp.body,
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  suggestionTitle: {
    ...typeRamp.body,
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  secondaryButton: {
    ...ghostBorder(0.2),
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.full,
    flexDirection: 'row',
    gap: theme.spacing[2],
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: theme.spacing[4],
  },
  secondaryButtonLabel: {
    ...typeRamp.body,
    fontWeight: '700',
  },
  sectionIntro: {
    ...typeRamp.bodyLg,
    color: theme.colors.textMuted,
  },
  sectionTitle: {
    ...typeRamp.title,
    fontSize: 20,
    lineHeight: 24,
  },
  segmentControl: {
    backgroundColor: theme.colors.surfaceLow,
    borderRadius: theme.radius.full,
    flexDirection: 'row',
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  segmentLabel: {
    ...typeRamp.body,
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
  },
  segmentLabelActive: {
    color: theme.colors.text,
    fontWeight: '700',
  },
  segmentOption: {
    ...ghostBorder(0.16),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  segmentOptionActive: {
    backgroundColor: theme.colors.primaryContainer,
  },
  segmentPill: {
    borderRadius: theme.radius.full,
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  segmentPillActive: {
    backgroundColor: theme.colors.surface,
  },
  segmentWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  statusPill: {
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  statusPillLabel: {
    ...typeRamp.body,
    fontSize: 12,
    lineHeight: 14,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  tabBar: {
    ...ghostBorder(0.14),
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: theme.spacing[3],
  },
  tabBarItem: {
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  tabBarLabel: {
    ...typeRamp.body,
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  tabBarLabelActive: {
    color: theme.colors.iosBlue,
    fontWeight: '700',
  },
  deleteZoneButton: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  deleteZoneLabel: {
    ...typeRamp.body,
    color: theme.colors.error,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  textLink: {
    ...typeRamp.body,
    color: theme.colors.iosBlue,
    fontWeight: '700',
  },
  toggleCard: {
    ...ghostBorder(0.16),
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: theme.spacing[4],
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[4],
  },
  topBarEdge: {
    minWidth: 40,
  },
  topBarTitle: {
    ...typeRamp.title,
    fontSize: 20,
  },
  vehicleRow: {
    ...ghostBorder(0.16),
    ...shadows.soft,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    flexDirection: 'row',
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  vehicleThumb: {
    borderRadius: theme.radius.md,
    height: 90,
    width: 90,
  },
  warningFill: {
    backgroundColor: '#E7A400',
  },
  warningSoft: {
    backgroundColor: 'rgba(231, 164, 0, 0.14)',
  },
  zoneCard: {
    ...ghostBorder(0.16),
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  zoneActions: {
    alignItems: 'flex-end',
    gap: theme.spacing[2],
  },
});

export default function DriveReadyApp() {
  return (
    <SafeAreaProvider>
      <DriveReadyRoot />
    </SafeAreaProvider>
  );
}
