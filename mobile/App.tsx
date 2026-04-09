import { GestureHandlerRootView } from 'react-native-gesture-handler';

import DriveReadyApp from './src/DriveReadyApp';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DriveReadyApp />
    </GestureHandlerRootView>
  );
}
