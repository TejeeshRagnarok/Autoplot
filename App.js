import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  View, 
  SafeAreaView, 
  ScrollView, 
  Text, 
  TouchableOpacity, 
  Dimensions, 
  StatusBar,
  Platform,
  Animated
} from 'react-native';
import { theme, lightTheme, darkTheme, crimsonTheme } from './constants/theme';
import VastuHeader from './components/VastuHeader';
import InputModule from './components/InputModule';
import CoreEngine from './components/CoreEngine';
import Canvas2D from './components/Canvas2D';
import ReportsPDF from './components/ReportsPDF';
import MasterTables from './components/MasterTables';
import { checkAyaVyayaYoni } from './constants/vastuData';
import { Ionicons } from '@expo/vector-icons';
import OnboardingSlides from './components/OnboardingSlides';
import LoginScreen from './components/LoginScreen';
import LandingPage from './components/LandingPage';
import LayoutEditor from './components/editor/LayoutEditor';
import { generateStructuredLayoutFromState, syncLayoutToState } from './components/editor/layoutBridge';
import { cloneLayout } from './components/editor/layoutModel';

export default function App() {
  const [language, setLanguage] = useState('en'); 
  const [activeTheme, setActiveTheme] = useState('light'); 
  const [activeTab, setActiveTab] = useState(Platform.OS === 'web' ? 'home' : 'input'); 
  const [hasCalculated, setHasCalculated] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [layoutData, setLayoutData] = useState(null);
  const [originalGeneratedLayout, setOriginalGeneratedLayout] = useState(null);
  const [dimensions, setDimensions] = useState({
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height
  });

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [sidebarWidthAnim] = useState(new Animated.Value(72));
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  useEffect(() => {
    Animated.timing(sidebarWidthAnim, {
      toValue: isSidebarExpanded ? 240 : 72,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [isSidebarExpanded]);

  const [onboardingState, setOnboardingState] = useState('loading'); // 'loading', 'slides', 'transitioning', 'none'

  // Check startup onboarding and auth state
  useEffect(() => {
    try {
      if (Platform.OS === 'web') {
        setOnboardingState('transitioning');
      } else {
        // Native mobile app onboarding slides logic (Unchanged)
        if (global.__hasSeenOnboarding) {
          setOnboardingState('transitioning');
        } else {
          setOnboardingState('slides');
        }
      }
    } catch (err) {
      console.log('Error checking onboarding storage:', err);
      setOnboardingState(Platform.OS === 'web' ? 'transitioning' : 'slides');
    }
  }, []);

  const handleFinishOnboarding = () => {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('hasSeenOnboarding', 'true');
      } else {
        global.__hasSeenOnboarding = true;
      }
    } catch (err) {
      console.log('Error saving onboarding storage:', err);
    }
    setOnboardingState('none');
  };

  const handleFinishTransition = () => {
    setOnboardingState('none');
  };

  // Track resizing for responsive layouts (Web browser resize support)
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions({ width: window.width, height: window.height });
    });
    return () => subscription?.remove();
  }, []);

  const isDesktop = dimensions.width > 990;

  const themeConfigs = {
    light: lightTheme,
    dark: darkTheme,
    crimson: crimsonTheme
  };
  const currentTheme = themeConfigs[activeTheme] || lightTheme;

  // Global application state
  const [state, setState] = useState({
    ownerName: "Venkat",
    dob: "25-07-1996",
    nakshatra: "Mrigashira",
    rashi: "Gemini",
    siteLength: "40",
    siteWidth: "30",
    siteFacing: "North",
    roadDirection: "North Road",
    mainDoorDirection: "North",
    compassAngle: "0",
    eastOpen: "2",
    westOpen: "2",
    northOpen: "4",
    southOpen: "4",
    stairsLocation: "Southwest",
    sumpLocation: "Northeast",
    boreLocation: "Northeast",
    septicLocation: "Northwest",
    outsideBtLocation: "Northwest",
    eventDate: "15-08-2026",
    customRooms: [
      { id: "1", name: "Pooja Room", length: "6", width: "6" },
      { id: "2", name: "Kitchen", length: "10", width: "8" },
      { id: "3", name: "Master Bedroom", length: "12", width: "9" },
      { id: "4", name: "Bathroom/Toilet 1", length: "6", width: "6" },
      { id: "5", name: "Dining Room", length: "8", width: "8" },
      { id: "6", name: "Study Room", length: "10", width: "8" },
      { id: "7", name: "Guest Room", length: "10", width: "9" },
      { id: "8", name: "Bathroom/Toilet 2", length: "6", width: "6" },
      { id: "9", name: "Store Room", length: "8", width: "8" }
    ]
  });

  // Auto-select first room ID when state loads
  useEffect(() => {
    if (state.customRooms.length > 0 && !selectedRoomId) {
      setSelectedRoomId(state.customRooms[0].id);
    }
  }, [state.customRooms]);

  const updateState = (field, value) => {
    setState(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const loadTestCase = (testData) => {
    setState(testData);
    setHasCalculated(true);
    if (testData.customRooms.length > 0) {
      setSelectedRoomId(testData.customRooms[0].id);
    }
    setActiveTab('canvas'); 
  };

  const handleTabPress = (tabId) => {
    if (tabId !== 'input' && tabId !== 'login' && !hasCalculated) {
      alert(isTe ? "దయచేసి ముందుగా ప్లాన్ లెక్కించడానికి 'Calculate & Generate' బటన్ నొక్కండి." : "Please click the 'Calculate & Generate 2D Plan' button on the input tab first.");
      return;
    }
    setActiveTab(tabId);
  };

  const handleOpenEditor = () => {
    if (!layoutData) {
      const generated = generateStructuredLayoutFromState(state);
      setLayoutData(generated);
      setOriginalGeneratedLayout(cloneLayout(generated));
    }
    setActiveTab('editor');
  };

  const handleSaveAndCloseEditor = (updatedLayout) => {
    setLayoutData(updatedLayout);
    const nextState = syncLayoutToState(updatedLayout, state);
    setState(nextState);
    setActiveTab('canvas');
  };

  const isTe = language === 'te';

  // Navigation Items
  const navItems = [
    { id: 'input', icon: 'create-outline', labelEn: 'Input Details', labelTe: 'ఇన్పుట్' },
    { id: 'core', icon: 'calculator-outline', labelEn: 'Vastu Core', labelTe: 'గణాంకాలు' },
    { id: 'canvas', icon: 'map-outline', labelEn: '2D Plan', labelTe: 'ప్లాన్' },
    { id: 'editor', icon: 'color-wand-outline', labelEn: 'Edit Layout', labelTe: 'సవరణ' },
    { id: 'pdf', icon: 'document-text-outline', labelEn: 'PDF Report', labelTe: 'రిపోర్ట్' },
    { id: 'tables', icon: 'list-outline', labelEn: 'Charts', labelTe: 'పట్టికలు' },
  ];

  const renderActiveComponent = () => {
    switch (activeTab) {
      case 'home':
      case 'input':
        if (Platform.OS === 'web') {
          return (
            <LandingPage 
              onGetStarted={(tabId = 'input') => {
                setActiveTab(tabId);
              }} 
              theme={currentTheme}
              language={language}
              scrollToInputsOnMount={activeTab === 'input'}
              renderInputs={
                <InputModule 
                  language={language} 
                  state={state} 
                  updateState={updateState} 
                  theme={currentTheme} 
                  setActiveTab={setActiveTab}
                  onCalculate={() => {
                    setHasCalculated(true);
                    const generated = generateStructuredLayoutFromState(state);
                    setLayoutData(generated);
                    setOriginalGeneratedLayout(cloneLayout(generated));
                    setActiveTab('canvas');
                  }} 
                  hideFooter={true}
                />
              }
            />
          );
        } else {
          return (
            <InputModule 
              language={language} 
              state={state} 
              updateState={updateState} 
              theme={currentTheme} 
              setActiveTab={setActiveTab}
              onCalculate={() => {
                setHasCalculated(true);
                const generated = generateStructuredLayoutFromState(state);
                setLayoutData(generated);
                setOriginalGeneratedLayout(cloneLayout(generated));
                setActiveTab('canvas');
              }} 
            />
          );
        }
      case 'login':
        return (
          <LoginScreen 
            theme={currentTheme}
            onLoginSuccess={() => {
              setActiveTab('input');
            }} 
          />
        );
      case 'core':
        return <CoreEngine language={language} state={state} theme={currentTheme} />;
      case 'editor':
        return (
          <LayoutEditor
            initialLayout={layoutData || generateStructuredLayoutFromState(state)}
            originalGeneratedLayout={originalGeneratedLayout || generateStructuredLayoutFromState(state)}
            onSaveAndClose={handleSaveAndCloseEditor}
            onClose={() => setActiveTab('canvas')}
            theme={currentTheme}
          />
        );
      case 'canvas':
        return (
          <Canvas2D
            language={language}
            state={state}
            theme={currentTheme}
            onOpenEditor={handleOpenEditor}
            layoutData={layoutData}
          />
        );
      case 'pdf':
        return (
          <ReportsPDF
            language={language}
            state={state}
            theme={currentTheme}
            onOpenEditor={handleOpenEditor}
          />
        );
      case 'tables':
        return <MasterTables language={language} theme={currentTheme} />;
      default:
        return (
          <InputModule 
            language={language} 
            state={state} 
            updateState={updateState} 
            theme={currentTheme} 
            setActiveTab={setActiveTab}
            onCalculate={() => {
              setHasCalculated(true);
              const generated = generateStructuredLayoutFromState(state);
              setLayoutData(generated);
              setOriginalGeneratedLayout(cloneLayout(generated));
              setActiveTab('canvas');
            }} 
          />
        );
    }
  };

  // ----------------------------------------------------
  // DESKTOP PROPERTY PANEL (RIGHT SIDEBAR)
  // ----------------------------------------------------
  const renderRightPropertyPanel = () => {
    const selectedRoom = state.customRooms.find(r => r.id === selectedRoomId) || state.customRooms[0];
    if (!selectedRoom) return null;

    const roomRes = checkAyaVyayaYoni(selectedRoom.width, selectedRoom.length);

    return (
      <View style={[styles.rightSidebar, { backgroundColor: currentTheme.colors.surface, borderLeftColor: currentTheme.colors.border }]}>
        <View style={[styles.rightHeader, { borderBottomColor: currentTheme.colors.divider }]}>
          <Ionicons name="options-outline" size={16} color={currentTheme.colors.text} />
          <Text style={[styles.rightTitle, { color: currentTheme.colors.text }]}>{isTe ? "ప్రాపర్టీ ఇన్‌స్పెక్టర్" : "Property Inspector"}</Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
          {/* Room Selector list */}
          <View style={styles.propGroup}>
            <Text style={[styles.propLabel, { color: currentTheme.colors.textSecondary }]}>{isTe ? "గదిని ఎంచుకోండి" : "Inspect Room"}</Text>
            <View style={styles.roomSelectContainer}>
              {state.customRooms.map((r) => (
                <TouchableOpacity 
                  key={r.id} 
                  style={[
                    styles.miniRoomSelectorBtn, 
                    { borderColor: currentTheme.colors.border },
                    selectedRoomId === r.id && [styles.miniRoomSelectorBtnActive, { backgroundColor: currentTheme.colors.accent, borderColor: currentTheme.colors.accent }]
                  ]}
                  onPress={() => setSelectedRoomId(r.id)}
                >
                  <Text style={[
                    styles.miniRoomTextLabel, 
                    { color: currentTheme.colors.text },
                    selectedRoomId === r.id && { color: '#070262', fontWeight: '700' }
                  ]}>
                    {r.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.propDivider, { backgroundColor: currentTheme.colors.divider }]} />

          {/* Room dimensions & compliance properties */}
          <View style={styles.propGroup}>
            <Text style={[styles.propLabel, { color: currentTheme.colors.textSecondary }]}>{isTe ? "పరిమాణం మరియు ఏరియా" : "Dimensions & Area"}</Text>
            <View style={[styles.propValueCard, { backgroundColor: currentTheme.colors.background, borderColor: currentTheme.colors.border }]}>
              <View style={styles.propRow}>
                <Text style={[styles.propField, { color: currentTheme.colors.textSecondary }]}>{isTe ? "కొలతలు" : "Size L×W"}</Text>
                <Text style={[styles.propValText, { color: currentTheme.colors.text }]}>{selectedRoom.width} × {selectedRoom.length} ft</Text>
              </View>
              <View style={styles.propRow}>
                <Text style={[styles.propField, { color: currentTheme.colors.textSecondary }]}>{isTe ? "వైశాల్యం" : "Carpet Area"}</Text>
                <Text style={[styles.propValText, { color: currentTheme.colors.text }]}>{roomRes.area} Sq.Ft</Text>
              </View>
            </View>
          </View>

          <View style={styles.propGroup}>
            <Text style={[styles.propLabel, { color: currentTheme.colors.textSecondary }]}>{isTe ? "ఆయ వ్యయ గుణాంకాలు" : "Aya & Vyaya Vastu"}</Text>
            <View style={[styles.propValueCard, { backgroundColor: currentTheme.colors.background, borderColor: currentTheme.colors.border }]}>
              <View style={styles.propRow}>
                <Text style={[styles.propField, { color: currentTheme.colors.textSecondary }]}>{isTe ? "ఆదాయం (Ayam)" : "Aya value"}</Text>
                <Text style={[styles.propValText, { color: currentTheme.colors.text }]}>{roomRes.aya}</Text>
              </View>
              <View style={styles.propRow}>
                <Text style={[styles.propField, { color: currentTheme.colors.textSecondary }]}>{isTe ? "వ్యయం (Vyayam)" : "Vyaya value"}</Text>
                <Text style={[styles.propValText, { color: currentTheme.colors.text }]}>{roomRes.vyaya}</Text>
              </View>
              <View style={styles.propRow}>
                <Text style={[styles.propField, { color: currentTheme.colors.textSecondary }]}>{isTe ? "యోని ఫలితం" : "Yoni"}</Text>
                <Text style={[styles.propValText, { color: currentTheme.colors.text, fontSize: 11 }]}>{roomRes.yoni}</Text>
              </View>
            </View>
          </View>

          <View style={styles.propGroup}>
            <Text style={[styles.propLabel, { color: currentTheme.colors.textSecondary }]}>{isTe ? "వాస్తు అనుకూల ఫలితం" : "Vastu Compliance"}</Text>
            <View style={[
              styles.complianceBanner,
              { borderColor: roomRes.status === 'success' ? currentTheme.colors.success : currentTheme.colors.danger }
            ]}>
               <Ionicons 
                 name={roomRes.status === 'success' ? "checkmark-circle-outline" : "alert-circle-outline"} 
                 size={18} 
                 color={roomRes.status === 'success' ? currentTheme.colors.success : currentTheme.colors.danger} 
               />
               <Text style={[
                 styles.complianceText,
                 { color: roomRes.status === 'success' ? currentTheme.colors.success : roomRes.status === 'warning' ? currentTheme.colors.warning : currentTheme.colors.danger }
               ]}>
                 {isTe ? roomRes.resultTextTe : roomRes.resultText}
               </Text>
            </View>
          </View>

          {/* Vastu Correction suggestions */}
          {roomRes.status === 'danger' && roomRes.alternatives.length > 0 && (
            <View style={styles.propGroup}>
              <Text style={[styles.propLabel, { color: currentTheme.colors.textSecondary }]}>{isTe ? "వాస్తు దిద్దుబాట్లు" : "Vastu Recommendations"}</Text>
              <View style={[styles.suggestionsCard, { backgroundColor: currentTheme.colors.background, borderColor: currentTheme.colors.border }]}>
                {roomRes.alternatives.slice(0, 2).map((alt, idx) => (
                  <Text key={idx} style={[styles.suggestionItemText, { color: currentTheme.colors.text }]}>
                    • {isTe ? "కొలతను" : "Try"} {alt.width} × {alt.length} ft {isTe ? "గా మార్చండి" : ""}
                  </Text>
                ))}
              </View>
            </View>
          )}

        </ScrollView>
      </View>
    );
  };

  // ----------------------------------------------------
  // DESKTOP LAYOUT (SPLIT THREE PANEL PANELS)
  // ----------------------------------------------------
  const renderDesktopLayout = () => {
    if (activeTab === 'editor') {
      return (
        <View style={{ flex: 1, width: '100%', height: '100%' }}>
          {renderActiveComponent()}
        </View>
      );
    }

    // Responsive horizontal padding removed from outer workspace to let footer span full width
    let webHorizontalPadding = 0;

    return (
      <View style={[styles.desktopMainContainer, { backgroundColor: currentTheme.colors.background }]}>
        {/* Left Navigation Sidebar (Animated Width) - Rendered ONLY in Desktop App viewports, hidden on website viewports */}
        {Platform.OS !== 'web' && (
          <Animated.View style={[
            styles.leftSidebar, 
            { 
              width: sidebarWidthAnim, 
              backgroundColor: currentTheme.colors.surface, 
              borderRightColor: currentTheme.colors.border 
            }
          ]}>
            {/* Sidebar Header with Menu icon toggle */}
            <View style={[
              styles.leftSidebarHeader, 
              { 
                borderBottomColor: currentTheme.colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: isSidebarExpanded ? 'space-between' : 'center',
                paddingHorizontal: isSidebarExpanded ? 16 : 0,
              }
            ]}>
              {isSidebarExpanded && (
                <Text style={[styles.menuTitleText, { color: currentTheme.colors.textSecondary }]}>
                  {isTe ? "నావిగేషన్" : "PROJECT SHEETS"}
                </Text>
              )}
              <TouchableOpacity 
                onPress={() => setIsSidebarExpanded(!isSidebarExpanded)} 
                style={[styles.menuIconButton, { padding: 6 }]}
              >
                <Ionicons name="menu-outline" size={22} color={currentTheme.colors.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                const isLocked = item.id !== 'input' && !hasCalculated;
                
                // Dynamic themes styling
                const activeBg = currentTheme.colors.primaryLight;
                const activeColor = activeTheme === 'dark' ? currentTheme.colors.accent : currentTheme.colors.primary;
                const inactiveColor = currentTheme.colors.textSecondary;
                const lockedColor = activeTheme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)';
                
                return (
                  <TouchableOpacity 
                    key={item.id}
                    style={[
                      styles.sidebarBtn, 
                      isActive && [styles.sidebarBtnActive, { backgroundColor: activeBg, borderLeftColor: currentTheme.colors.accent }],
                      !isSidebarExpanded && { justifyContent: 'center', paddingHorizontal: 0 }
                    ]}
                    onPress={() => handleTabPress(item.id)}
                    activeOpacity={isLocked ? 0.5 : 0.8}
                  >
                    <Ionicons 
                      name={isLocked ? "lock-closed-outline" : item.icon} 
                      size={18} 
                      color={isActive ? activeColor : isLocked ? lockedColor : inactiveColor} 
                    />
                    {isSidebarExpanded && (
                      <Text style={[
                        styles.sidebarBtnText, 
                        { color: isActive ? activeColor : isLocked ? lockedColor : inactiveColor },
                        isActive && { color: activeColor, fontWeight: '700' }
                      ]}>
                        {isTe ? item.labelTe : item.labelEn}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Animated.View>
        )}

        {/* Center content Area */}
        <View style={[styles.centerWorkspace, { backgroundColor: currentTheme.colors.background }]}>
          {renderActiveComponent()}
        </View>
 
        {/* Right Property Inspector Panel - Rendered ONLY in Desktop App viewports, hidden on website viewports */}
        {Platform.OS !== 'web' && renderRightPropertyPanel()}
      </View>
    );
  };

  // ----------------------------------------------------
  // MOBILE LAYOUT (STANDARD TAB SYSTEM)
  // ----------------------------------------------------
  const renderMobileLayout = () => {
    if (activeTab === 'editor') {
      return (
        <View style={{ flex: 1, width: '100%', height: '100%' }}>
          {renderActiveComponent()}
        </View>
      );
    }

    const isWebOrWide = Platform.OS === 'web' || dimensions.width >= 480;
    
    // Responsive horizontal padding removed from outer workspace to let footer span full width
    let webHorizontalPadding = 0;

    return (
      <View style={[styles.mainWrapper, { backgroundColor: currentTheme.colors.background }]}>
        <View style={[styles.contentContainer, { paddingBottom: Platform.OS === 'web' ? 0 : 84 }]}>
          {renderActiveComponent()}
        </View>

        {/* Bottom Tab navigation */}
        {Platform.OS !== 'web' && (
          <View style={[styles.bottomNavContainer, { backgroundColor: currentTheme.colors.surface, borderTopColor: currentTheme.colors.border }]}>
            {isWebOrWide ? (
              <View style={styles.bottomNavFlex}>
                {navItems.map((tab) => {
                  const isActive = activeTab === tab.id;
                  const isLocked = tab.id !== 'input' && !hasCalculated;
                  const activeColor = activeTheme === 'dark' ? '#FBBF24' : currentTheme.colors.primary;
                  return (
                    <TouchableOpacity 
                      key={tab.id}
                      style={[styles.tabButtonFlex, isActive && { borderBottomColor: currentTheme.colors.accent }]}
                      onPress={() => handleTabPress(tab.id)}
                      activeOpacity={isLocked ? 0.5 : 0.8}
                    >
                      <Ionicons 
                        name={isLocked ? "lock-closed-outline" : tab.icon} 
                        size={18} 
                        color={isActive ? activeColor : isLocked ? "rgba(0,0,0,0.15)" : currentTheme.colors.textSecondary} 
                      />
                      <Text style={[styles.tabLabel, { color: isActive ? activeColor : isLocked ? "rgba(0,0,0,0.2)" : currentTheme.colors.textSecondary }, isActive && { fontWeight: '800' }]}>
                        {isTe ? tab.labelTe : tab.labelEn}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bottomNavScroll}>
                {navItems.map((tab) => {
                  const isActive = activeTab === tab.id;
                  const isLocked = tab.id !== 'input' && !hasCalculated;
                  const activeColor = activeTheme === 'dark' ? '#FBBF24' : currentTheme.colors.primary;
                  return (
                    <TouchableOpacity 
                      key={tab.id}
                      style={[styles.tabButton, isActive && { borderBottomColor: currentTheme.colors.accent }]}
                      onPress={() => handleTabPress(tab.id)}
                      activeOpacity={isLocked ? 0.5 : 0.8}
                    >
                      <Ionicons 
                        name={isLocked ? "lock-closed-outline" : tab.icon} 
                        size={18} 
                        color={isActive ? activeColor : isLocked ? "rgba(0,0,0,0.15)" : currentTheme.colors.textSecondary} 
                      />
                      <Text style={[styles.tabLabel, { color: isActive ? activeColor : isLocked ? "rgba(0,0,0,0.2)" : currentTheme.colors.textSecondary }, isActive && { fontWeight: '800' }]}>
                        {isTe ? tab.labelTe : tab.labelEn}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}
      </View>
    );
  };

  if (onboardingState === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: currentTheme.colors.background }]} />
    );
  }

  if (onboardingState === 'slides' || onboardingState === 'transitioning') {
    return (
      <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={true} />
        <OnboardingSlides 
          language={language}
          setLanguage={setLanguage}
          theme={currentTheme}
          autoStartTransition={onboardingState === 'transitioning'}
          onFinish={onboardingState === 'slides' ? handleFinishOnboarding : handleFinishTransition}
        />
      </View>
    );
  }



  return (
    <View style={[styles.container, { backgroundColor: currentTheme.colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      
      {Platform.OS === 'web' && (
        <style>
          {`
            /* Hide scrollbars globally on web browser viewports */
            ::-webkit-scrollbar {
              display: none !important;
            }
            * {
              -ms-overflow-style: none !important;
              scrollbar-width: none !important;
            }
          `}
        </style>
      )}
      
      {/* Top compact normal header (hidden in full CAD editor workspace) */}
      {activeTab !== 'editor' && (
        <VastuHeader 
          language={language}
          setLanguage={setLanguage}
          activeTheme={activeTheme}
          setActiveTheme={setActiveTheme}
          compassAngle={state.compassAngle}
          showMenuButton={Platform.OS === 'web' && !isDesktop}
          onMenuPress={() => setIsMobileDrawerOpen(true)}
          activeTab={activeTab}
          setActiveTab={handleTabPress}
          navItems={navItems}
          hasCalculated={hasCalculated}
          isDesktop={isDesktop}
        />
      )}

      {/* Conditional Layout Rendering */}
      {isDesktop ? renderDesktopLayout() : renderMobileLayout()}

      {/* Mobile Web Navigation Drawer Overlay */}
      {Platform.OS === 'web' && !isDesktop && isMobileDrawerOpen && (
        <React.Fragment>
          {/* Backdrop */}
          <TouchableOpacity 
            activeOpacity={1}
            style={styles.drawerBackdrop} 
            onPress={() => setIsMobileDrawerOpen(false)}
          />
          {/* Drawer content */}
          <View style={[styles.drawerContainer, { backgroundColor: currentTheme.colors.surface, borderRightColor: currentTheme.colors.border }]}>
            <View style={[styles.drawerHeader, { borderBottomColor: currentTheme.colors.border }]}>
              <Text style={[styles.drawerTitleText, { color: currentTheme.colors.text }]}>
                {isTe ? "నావిగేషన్" : "PROJECT SHEETS"}
              </Text>
              <TouchableOpacity onPress={() => setIsMobileDrawerOpen(false)} style={styles.drawerCloseButton}>
                <Ionicons name="close-outline" size={24} color={currentTheme.colors.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                const isLocked = item.id !== 'input' && !hasCalculated;
                
                const activeBg = currentTheme.colors.primaryLight;
                const activeColor = activeTheme === 'dark' ? currentTheme.colors.accent : currentTheme.colors.primary;
                const inactiveColor = currentTheme.colors.textSecondary;
                const lockedColor = activeTheme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)';
                
                return (
                  <TouchableOpacity 
                    key={item.id}
                    style={[
                      styles.sidebarBtn, 
                      isActive && [styles.sidebarBtnActive, { backgroundColor: activeBg, borderLeftColor: currentTheme.colors.accent }]
                    ]}
                    onPress={() => {
                      handleTabPress(item.id);
                      setIsMobileDrawerOpen(false);
                    }}
                    activeOpacity={isLocked ? 0.5 : 0.8}
                  >
                    <Ionicons 
                      name={isLocked ? "lock-closed-outline" : item.icon} 
                      size={18} 
                      color={isActive ? activeColor : isLocked ? lockedColor : inactiveColor} 
                    />
                    <Text style={[
                      styles.sidebarBtnText, 
                      { color: isActive ? activeColor : isLocked ? lockedColor : inactiveColor },
                      isActive && { color: activeColor, fontWeight: '700' }
                    ]}>
                      {isTe ? item.labelTe : item.labelEn}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </React.Fragment>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  desktopMainContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  leftSidebar: {
    height: '100%',
    borderRightWidth: 1.2,
  },
  leftSidebarHeader: {
    height: 64,
    borderBottomWidth: 1.2,
  },
  menuTitleText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  menuIconButton: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  sidebarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderLeftWidth: 3.5,
    borderLeftColor: 'transparent',
  },
  sidebarBtnActive: {
    borderLeftWidth: 3.5,
  },
  sidebarBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sidebarBtnTextActive: {
    fontWeight: '700',
  },
  centerWorkspace: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  rightSidebar: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderLeftWidth: 1.2,
    borderLeftColor: theme.colors.border,
  },
  rightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderBottomWidth: 1.2,
    borderBottomColor: theme.colors.divider,
  },
  rightTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  propGroup: {
    gap: 6,
  },
  propLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  roomSelectContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  miniRoomSelectorBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    backgroundColor: '#F9FAFB',
  },
  miniRoomSelectorBtnActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primaryLight,
  },
  miniRoomTextLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  miniRoomTextLabelActive: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  propValueCard: {
    backgroundColor: '#FAFBFD',
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  propRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  propField: {
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  propValText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.text,
  },
  complianceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.2,
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#FAFBFD',
  },
  complianceText: {
    fontSize: 11,
    fontWeight: '700',
  },
  suggestionsCard: {
    backgroundColor: '#FFFBE6',
    borderWidth: 1,
    borderColor: '#FFE58F',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  suggestionItemText: {
    fontSize: 11,
    color: '#D46B08',
    lineHeight: 16,
  },
  propDivider: {
    height: 1,
    backgroundColor: theme.colors.divider,
  },
  mainWrapper: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
  },
  bottomNavContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1.5,
    borderTopColor: theme.colors.border,
    paddingVertical: 12,
    paddingBottom: 24,
    height: 84,
  },
  bottomNavScroll: {
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 12,
  },
  tabButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  activeTabButton: {
    backgroundColor: 'rgba(7, 2, 98, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(7, 2, 98, 0.15)',
  },
  bottomNavFlex: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    height: '100%',
  },
  tabButtonFlex: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  activeTabLabel: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  drawerBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 9998,
  },
  drawerContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 280,
    borderRightWidth: 1.2,
    paddingVertical: 16,
    zIndex: 9999,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderBottomWidth: 1.2,
    marginBottom: 12,
  },
  drawerTitleText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  drawerCloseButton: {
    padding: 4,
  }
});
