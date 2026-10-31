// Custom entry: besides the expo-router app, register the screen the system opens over other apps
// (autofill) and from Credential Manager (passkeys).
import './src/polyfills';
import { AppRegistry } from 'react-native';
import { AutofillRoot } from './src/autofill/AutofillRoot';
import 'expo-router/entry';

AppRegistry.registerComponent('VoultAutofill', () => AutofillRoot);
