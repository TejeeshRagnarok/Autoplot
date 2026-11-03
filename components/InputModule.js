import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  Modal, 
  FlatList,
  Dimensions,
  Image,
  Platform
} from 'react-native';
import { lightTheme as staticTheme } from '../constants/theme';
import { NAKSHATRAS, calculateOptimalRoomDimensions } from '../constants/vastuData';
import { getSourceKey } from './editor/layoutBridge';
import { Ionicons } from '@expo/vector-icons';
import VastuFooter from './VastuFooter';
import LandingPage from './LandingPage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const FACING_OPTIONS = ["East", "West", "North", "South"];
const ROAD_OPTIONS = [
  "East Road", 
  "West Road", 
  "North Road", 
  "South Road", 
  "Corner E+N", 
  "Corner W+S"
];
const ROOM_NAMES = [
  "Pooja Room",
  "Kitchen",
  "Master Bedroom",
  "Bathroom/Toilet",
  "Dining Room",
  "Study Room",
  "Guest Room",
  "Living Room",
  "Office Room",
  "Gym Room"
];

const DIRECTION_OPTIONS = ["East", "West", "North", "South", "Northeast", "Southeast", "Southwest", "Northwest"];

export default function InputModule({ language, state, updateState, theme: propTheme, setActiveTab, onCalculate, hideFooter = false }) {
  const theme = propTheme || staticTheme;
  const styles = getStyles(theme);
  const scrollRef = useRef(null);
  const isTe = language === 'te';
  const [sliderIndex, setSliderIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const sliderWidth = SCREEN_WIDTH - 32;

  // Automatically calculate optimal, Vastu-compliant room dimensions when footprint or room count changes
  useEffect(() => {
    // These inputs were just written from the edited layout: re-optimizing them
    // would discard the editor's room sizes and regenerate the building.
    if (state.lastEditedLayout?.syncedSourceKey === getSourceKey(state)) return;
    if (state.customRooms && state.customRooms.length > 0) {
      const optimizedRooms = calculateOptimalRoomDimensions(
        state.customRooms,
        state.siteLength,
        state.siteWidth,
        state.eastOpen,
        state.westOpen,
        state.northOpen,
        state.southOpen
      );
      const hasChanged = optimizedRooms.some((r, idx) => r.width !== state.customRooms[idx]?.width || r.length !== state.customRooms[idx]?.length);
      if (hasChanged) {
        updateState('customRooms', optimizedRooms);
      }
    }
  }, [
    state.siteLength, 
    state.siteWidth, 
    state.eastOpen, 
    state.westOpen, 
    state.northOpen, 
    state.southOpen, 
    state.customRooms.length
  ]);

  const sliderImages = [
    {
      url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
      titleEn: "Auspicious Vastu Architecture",
      titleTe: "శుభప్రదమైన వాస్తు ప్రణాళికలు",
      descEn: "Designing spaces for health, wealth & harmony.",
      descTe: "ఆరోగ్యం, ఐశ్వర్యం మరియు శాంతి కొరకు గృహాల అమరిక."
    },
    {
      url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
      titleEn: "Ancient Wisdom, Modern Living",
      titleTe: "పురాతన విజ్ఞానం - ఆధునిక జీవనం",
      descEn: "Aligning energy grids (Mandala) with modern building tech.",
      descTe: "ఆధునిక గృహ కొలతలతో శాస్త్రీయ అనుసంధానం."
    },
    {
      url: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=80",
      titleEn: "Eeshanya (Northeast) Pooja Zone",
      titleTe: "ఈశాన్య దిశ - దైవ సన్నిధి",
      descEn: "Auspicious water element placement for clear intellect.",
      descTe: "ఆరోప్యవృద్ధి మరియు ప్రశాంతతకు జల స్థాన ప్రణాళిక."
    },
    {
      url: "https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=800&q=80",
      titleEn: "Agneya (Southeast) Energy Kitchen",
      titleTe: "ఆగ్నేయ మూల - అగ్ని స్థానం",
      descEn: "Auspicious positioning of cooktops for family health.",
      descTe: "కుటుంబ ఆరోగ్య క్షేమాల కొరకు వంటగది అమరిక."
    },
    {
      url: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=800&q=80",
      titleEn: "Nairutya (Southwest) Master Suite",
      titleTe: "నైరుతి దిశ - యజమాని నివాసం",
      descEn: "Earth element placement for strength, stability & leadership.",
      descTe: "స్థిరత్వం మరియు నాయకత్వ వృద్ధి కొరకు నైరుతి బెడ్ రూమ్."
    }
  ];

  const handleScroll = (event) => {
    const activeWidth = containerWidth || sliderWidth;
    const slide = Math.round(event.nativeEvent.contentOffset.x / activeWidth);
    if (slide !== sliderIndex) {
      setSliderIndex(slide);
    }
  };

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerData, setPickerData] = useState([]);
  const [pickerField, setPickerField] = useState("");
  const [pickerTitle, setPickerTitle] = useState("");

  const openPicker = (field, title, data) => {
    setPickerField(field);
    setPickerTitle(title);
    setPickerData(data);
    setPickerVisible(true);
  };

  const selectValue = (val) => {
    if (pickerField === 'nakshatra') {
      updateState('nakshatra', val);
      const matched = NAKSHATRAS.find(n => n.nameEn === val || n.nameTe === val);
      if (matched) {
        updateState('rashi', isTe ? matched.rashiTe : matched.rashiEn);
      }
    } else if (pickerField === 'roadDirection') {
      updateState('roadDirection', val);
      let suggestedDoor = "East";
      if (val.includes("East")) suggestedDoor = "East";
      else if (val.includes("West")) suggestedDoor = "West";
      else if (val.includes("North")) suggestedDoor = "North";
      else if (val.includes("South")) suggestedDoor = "South";
      updateState('mainDoorDirection', suggestedDoor);
    } else {
      updateState(pickerField, val);
    }
    setPickerVisible(false);
  };

  const addRoom = () => {
    const newRoom = {
      id: Date.now().toString(),
      name: "Living Room",
      length: "12",
      width: "10"
    };
    updateState('customRooms', [...state.customRooms, newRoom]);
  };

  const deleteRoom = (id) => {
    const updated = state.customRooms.filter(r => r.id !== id);
    updateState('customRooms', updated);
  };

  const updateRoomValue = (id, field, value) => {
    const updated = state.customRooms.map(r => {
      if (r.id === id) {
        return { ...r, [field]: value };
      }
      return r;
    });
    if (field === 'name') {
      const reCalculated = calculateOptimalRoomDimensions(
        updated,
        state.siteLength,
        state.siteWidth,
        state.eastOpen,
        state.westOpen,
        state.northOpen,
        state.southOpen
      );
      updateState('customRooms', reCalculated);
    } else {
      updateState('customRooms', updated);
    }
  };

  const getRoomColor = (name) => {
    const n = name.toLowerCase();
    if (n.includes("pooja")) return theme.colors.success;
    if (n.includes("kitchen")) return theme.colors.danger;
    if (n.includes("master")) return theme.colors.warning;
    return theme.colors.primary;
  };

  const getRoomIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes("pooja")) return "flame-outline";
    if (n.includes("kitchen")) return "restaurant-outline";
    if (n.includes("master")) return "bed-outline";
    if (n.includes("toilet") || n.includes("bathroom")) return "water-outline";
    return "grid-outline";
  };

  // Translations
  const t = {
    ownerHeader: isTe ? "యజమాని జాతక చక్రం" : "Client Horoscope Profile",
    ownerDesc: isTe ? "తారాబలం మరియు నామ వర్గ శోధనల కోసం." : "Astrological coordinates & name matching data.",
    nameLabel: isTe ? "యజమాని పూర్తి పేరు" : "Client Full Name",
    dobLabel: isTe ? "పుట్టిన తేదీ" : "DOB (Date of Birth)",
    nakshatraLabel: isTe ? "జన్మ నక్షత్రం" : "Janma Nakshatra",
    rashiLabel: isTe ? "రాశి" : "Rashi",
    
    siteHeader: isTe ? "ప్లాట్ కొలతలు & దిశా నిర్ధారణ" : "Plot Geometry & Facing",
    siteDesc: isTe ? "స్థలం యొక్క ఖచ్చితమైన పొడవు, వెడల్పు మరియు వీధుల అమరిక." : "Precise site dimensions, roads, and cardinal facing orientation.",
    siteLength: isTe ? "స్థలం పొడవు (L)" : "Site Length (L - ft)",
    siteWidth: isTe ? "స్థలం వెడల్పు (W)" : "Site Width (W - ft)",
    siteFacing: isTe ? "స్థలం దిశ (Facing)" : "Site Facing",
    roadDirection: isTe ? "రోడ్డు మార్గం (Road)" : "Roadway Facing",
    mainDoor: isTe ? "సింహద్వారం దిశ (Main Entrance)" : "Main Entrance Door Facing",
    
    compassHeader: isTe ? "డిజిటల్ కంపాస్ రోజ్" : "Vastu Compass Rose Dial",
    compassDesc: isTe ? "ప్లాన్ యొక్క కాన్వాస్ కోణాన్ని నియంత్రించండి" : "Rotate drawing workspace coordinates",
    
    openSpaceHeader: isTe ? "నలువైపులా ఖాళీ స్థలాలు (Setbacks)" : "Setback Corridor Margins",
    openSpaceDesc: isTe ? "భవనం చుట్టూ వదలవలసిన ఖాళీ స్థలాల కొలతలు." : "Rear, side, and front clear setback dimensions.",
    eastOpen: isTe ? "తూర్పు ఖాళీ (East)" : "East setback",
    westOpen: isTe ? "పడమర ఖాళీ (West)" : "West setback",
    northOpen: isTe ? "ఉత్తర ఖాళీ (North)" : "North setback",
    southOpen: isTe ? "దక్షిణ ఖాళీ (South)" : "South setback",
    
    roomBuilderHeader: isTe ? "భవన నిర్మాణ గదుల విభజన" : "Footprint Room Planner",
    roomBuilderDesc: isTe ? "వివిధ గదుల సైజులు మరియు వాటి సంఖ్యలను జోడించండి." : "Configure lengths, widths, and counts for individual rooms.",
    addRoomBtn: isTe ? "+ గదిని జోడించు" : "+ Add Room Module",
    
    othersHeader: isTe ? "ఇతర నిర్మాణ స్థానాలు (Utilities)" : "Utility & System Placements",
    othersDesc: isTe ? "సంప్, బోర్, మెట్లు మరియు సెప్టిక్ ట్యాంక్ స్థానాలు." : "Set cardinal directions for stairs, sumps, and borewells.",
    stairsLabel: isTe ? "మెట్లు (Stairs)" : "Outside Stairs",
    sumpLabel: isTe ? "నీటి సంప్ (Sump)" : "Underground Sump",
    boreLabel: isTe ? "బోర్-వెల్ (Borewell)" : "Borewell Location",
    septicLabel: isTe ? "సెప్టిక్ ట్యాంక్" : "Septic Tank",
    outsideBt: isTe ? "బయటి టాయిలెట్" : "Outside Toilet",
    eventDate: isTe ? "గృహారంభ తేదీ" : "Groundbreaking Date"
  };

  const steps = [
    { title: "Input", active: true },
    { title: "Processing", active: false },
    { title: "Layout", active: false },
    { title: "Review", active: false },
    { title: "Export", active: false },
  ];

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content}>

      {/* SWIPEABLE IMAGE SLIDER (NATIVE ONLY) */}
      {Platform.OS !== 'web' && (
        <View 
          style={styles.sliderContainer}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && w !== containerWidth) {
              setContainerWidth(w);
            }
          }}
        >
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            style={styles.sliderScroll}
          >
            {sliderImages.map((slide, idx) => (
              <View key={idx} style={[styles.slideCard, { width: containerWidth || sliderWidth }]}>
                <Image source={{ uri: slide.url }} style={styles.slideImage} />
                <View style={styles.slideOverlay} />
                <View style={styles.slideTextContainer}>
                  <Text style={styles.slideTitle}>{isTe ? slide.titleTe : slide.titleEn}</Text>
                  <Text style={styles.slideDesc}>{isTe ? slide.descTe : slide.descEn}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          {/* DOT CONTROLLER */}
          <View style={styles.sliderDots}>
            {sliderImages.map((_, idx) => (
              <View 
                key={idx} 
                style={[
                  styles.sliderDot, 
                  sliderIndex === idx ? styles.activeDot : styles.inactiveDot
                ]} 
              />
            ))}
          </View>
        </View>
      )}
      
      {/* GREETING CARD */}
      <View style={[styles.greetingCard, theme.elevation.soft]}>
        <View style={styles.greetingHeaderRow}>
          <Ionicons name="sparkles-sharp" size={18} color="#FBBF24" style={{ marginRight: 8 }} />
          <Text style={styles.greetingTitle}>
            {isTe ? "శుభమస్తు / Vastu Sarvaswam" : "Shubhamastu / Vastu Sarvaswam"}
          </Text>
        </View>
        <Text style={styles.greetingText}>
          {isTe 
            ? "మీ కలల గృహ నిర్మాణానికి వాస్తు నియమాలను మరియు అనుకూలమైన ఆయ-వ్యయ కొలతలను క్రింది వివరాల ద్వారా సులభంగా గణించండి."
            : "Calculate auspicious proportions and Vastu-compliant layout metrics for your dream home by completing the details below."}
        </Text>
      </View>

      {/* SECTION 1: OWNER DETAILS */}
      <View style={[styles.blueprintCard, theme.elevation.soft]}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="person-outline" size={20} color={theme.colors.accent} />
          <View>
            <Text style={styles.cardTitle}>{t.ownerHeader}</Text>
            <Text style={styles.cardDesc}>{t.ownerDesc}</Text>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>{t.nameLabel}</Text>
          <View style={styles.premiumInputGroup}>
            <View style={styles.premiumIconBadge}>
              <Ionicons name="person-outline" size={15} color={theme.colors.textSecondary} />
            </View>
            <TextInput 
              style={styles.premiumField} 
              value={state.ownerName}
              onChangeText={(val) => updateState('ownerName', val)}
            />
          </View>
        </View>

        <View style={styles.formRow}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.dobLabel}</Text>
            <View style={styles.premiumInputGroup}>
              <View style={styles.premiumIconBadge}>
                <Ionicons name="calendar-outline" size={15} color={theme.colors.textSecondary} />
              </View>
              <TextInput 
                style={styles.premiumField} 
                value={state.dob}
                onChangeText={(val) => updateState('dob', val)}
                placeholder="DD-MM-YYYY"
              />
            </View>
          </View>

          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.rashiLabel}</Text>
            <View style={[styles.premiumInputGroup, styles.disabledField]}>
              <View style={styles.premiumIconBadge}>
                <Ionicons name="sparkles-outline" size={15} color={theme.colors.textSecondary} />
              </View>
              <TextInput 
                style={[styles.premiumField, { color: theme.colors.textSecondary }]} 
                value={state.rashi}
                editable={false}
              />
            </View>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>{t.nakshatraLabel}</Text>
          <TouchableOpacity 
            style={styles.premiumSelect}
            onPress={() => openPicker('nakshatra', t.nakshatraLabel, NAKSHATRAS.map(n => isTe ? n.nameTe : n.nameEn))}
          >
            <View style={styles.selectLeft}>
              <Ionicons name="star-outline" size={15} color={theme.colors.textSecondary} />
              <Text style={styles.selectValText}>{state.nakshatra}</Text>
            </View>
            <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* SECTION 2: SITE DETAILS */}
      <View style={[styles.blueprintCard, theme.elevation.soft]}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="business-outline" size={20} color={theme.colors.accent} />
          <View>
            <Text style={styles.cardTitle}>{t.siteHeader}</Text>
            <Text style={styles.cardDesc}>{t.siteDesc}</Text>
          </View>
        </View>

        <View style={styles.formRow}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.siteLength}</Text>
            <View style={styles.premiumInputGroup}>
              <View style={styles.premiumIconBadge}>
                <Ionicons name="resize-outline" size={15} color={theme.colors.textSecondary} />
              </View>
              <TextInput style={styles.premiumField} keyboardType="numeric" value={state.siteLength} onChangeText={(val) => updateState('siteLength', val)} />
            </View>
          </View>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.siteWidth}</Text>
            <View style={styles.premiumInputGroup}>
              <View style={styles.premiumIconBadge}>
                <Ionicons name="resize-outline" size={15} color={theme.colors.textSecondary} />
              </View>
              <TextInput style={styles.premiumField} keyboardType="numeric" value={state.siteWidth} onChangeText={(val) => updateState('siteWidth', val)} />
            </View>
          </View>
        </View>

        <View style={styles.formRow}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.siteFacing}</Text>
            <TouchableOpacity style={styles.premiumSelect} onPress={() => openPicker('siteFacing', t.siteFacing, FACING_OPTIONS)}>
              <View style={styles.selectLeft}>
                <Ionicons name="compass-outline" size={15} color={theme.colors.textSecondary} />
                <Text style={styles.selectValText}>{state.siteFacing}</Text>
              </View>
              <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.roadDirection}</Text>
            <TouchableOpacity style={styles.premiumSelect} onPress={() => openPicker('roadDirection', t.roadDirection, ROAD_OPTIONS)}>
              <View style={styles.selectLeft}>
                <Ionicons name="navigate-outline" size={15} color={theme.colors.textSecondary} />
                <Text style={styles.selectValText}>{state.roadDirection}</Text>
              </View>
              <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>{t.mainDoor}</Text>
          <TouchableOpacity style={styles.premiumSelect} onPress={() => openPicker('mainDoorDirection', t.mainDoor, DIRECTION_OPTIONS)}>
            <View style={styles.selectLeft}>
              <Ionicons name="log-in-outline" size={15} color={theme.colors.textSecondary} />
              <Text style={styles.selectValText}>{state.mainDoorDirection}</Text>
            </View>
            <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>



      {/* SECTION 3: OPEN SPACES */}
      <View style={[styles.blueprintCard, theme.elevation.soft]}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="git-commit-outline" size={20} color={theme.colors.accent} />
          <View>
            <Text style={styles.cardTitle}>{t.openSpaceHeader}</Text>
            <Text style={styles.cardDesc}>{t.openSpaceDesc}</Text>
          </View>
        </View>

        <View style={styles.formRow}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.eastOpen}</Text>
            <View style={styles.premiumInputGroup}>
              <TextInput style={[styles.premiumField, { paddingLeft: 12 }]} keyboardType="numeric" value={state.eastOpen} onChangeText={(val) => updateState('eastOpen', val)} />
            </View>
          </View>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.westOpen}</Text>
            <View style={styles.premiumInputGroup}>
              <TextInput style={[styles.premiumField, { paddingLeft: 12 }]} keyboardType="numeric" value={state.westOpen} onChangeText={(val) => updateState('westOpen', val)} />
            </View>
          </View>
        </View>

        <View style={styles.formRow}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.northOpen}</Text>
            <View style={styles.premiumInputGroup}>
              <TextInput style={[styles.premiumField, { paddingLeft: 12 }]} keyboardType="numeric" value={state.northOpen} onChangeText={(val) => updateState('northOpen', val)} />
            </View>
          </View>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.southOpen}</Text>
            <View style={styles.premiumInputGroup}>
              <TextInput style={[styles.premiumField, { paddingLeft: 12 }]} keyboardType="numeric" value={state.southOpen} onChangeText={(val) => updateState('southOpen', val)} />
            </View>
          </View>
        </View>
      </View>

      {/* SECTION 4: ROOM PLANNERS */}
      <View style={[styles.blueprintCard, theme.elevation.soft]}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="grid-outline" size={20} color={theme.colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t.roomBuilderHeader}</Text>
            <Text style={styles.cardDesc}>{t.roomBuilderDesc}</Text>
          </View>
        </View>

        {state.customRooms.map((room) => {
          const roomColor = getRoomColor(room.name);
          const icon = getRoomIcon(room.name);
          return (
            <View key={room.id} style={[styles.blueprintRoomStamp, { borderLeftColor: roomColor }]}>
              {/* Stamp-like interior title */}
              <TouchableOpacity 
                style={styles.stampLeftBtn} 
                onPress={() => openPicker(`roomName_${room.id}`, isTe ? "గది ఎంచుకోండి" : "Select Room", ROOM_NAMES)}
              >
                <Ionicons name={icon} size={15} color={roomColor} style={{ marginRight: 6 }} />
                <Text style={styles.stampNameText} numberOfLines={1}>{room.name}</Text>
                <Ionicons name="chevron-down-outline" size={12} color={theme.colors.textSecondary} style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>

              {/* Dimensions */}
              <View style={styles.stampDimContainer}>
                <View style={styles.stampCoordInput}>
                  <Text style={styles.stampCoordLabel}>L</Text>
                  <TextInput
                    style={styles.stampCoordText}
                    keyboardType="numeric"
                    value={room.length}
                    onChangeText={(val) => updateRoomValue(room.id, 'length', val)}
                  />
                </View>

                <View style={styles.stampCoordInput}>
                  <Text style={styles.stampCoordLabel}>W</Text>
                  <TextInput
                    style={styles.stampCoordText}
                    keyboardType="numeric"
                    value={room.width}
                    onChangeText={(val) => updateRoomValue(room.id, 'width', val)}
                  />
                </View>

                <TouchableOpacity style={styles.stampDeleteBtn} onPress={() => deleteRoom(room.id)}>
                  <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {/* full width Add Button */}
        <TouchableOpacity style={styles.fullWidthAddBtn} onPress={addRoom} activeOpacity={0.8}>
          <Ionicons name="add-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.fullWidthAddText}>{t.addRoomBtn}</Text>
        </TouchableOpacity>
      </View>

      {/* SECTION 5: UTILITIES */}
      <View style={[styles.blueprintCard, theme.elevation.soft]}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="options-outline" size={20} color={theme.colors.accent} />
          <View>
            <Text style={styles.cardTitle}>{t.othersHeader}</Text>
            <Text style={styles.cardDesc}>{t.othersDesc}</Text>
          </View>
        </View>

        <View style={styles.formRow}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.stairsLabel}</Text>
            <TouchableOpacity style={styles.premiumSelect} onPress={() => openPicker('stairsLocation', t.stairsLabel, DIRECTION_OPTIONS)}>
              <Text style={styles.selectValText}>{state.stairsLocation}</Text>
              <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.sumpLabel}</Text>
            <TouchableOpacity style={styles.premiumSelect} onPress={() => openPicker('sumpLocation', t.sumpLabel, DIRECTION_OPTIONS)}>
              <Text style={styles.selectValText}>{state.sumpLocation}</Text>
              <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.formRow}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.boreLabel}</Text>
            <TouchableOpacity style={styles.premiumSelect} onPress={() => openPicker('boreLocation', t.boreLabel, DIRECTION_OPTIONS)}>
              <Text style={styles.selectValText}>{state.boreLocation}</Text>
              <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.septicLabel}</Text>
            <TouchableOpacity style={styles.premiumSelect} onPress={() => openPicker('septicLocation', t.septicLabel, DIRECTION_OPTIONS)}>
              <Text style={styles.selectValText}>{state.septicLocation}</Text>
              <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.formRow}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.outsideBt}</Text>
            <TouchableOpacity style={styles.premiumSelect} onPress={() => openPicker('outsideBtLocation', t.outsideBt, DIRECTION_OPTIONS)}>
              <Text style={styles.selectValText}>{state.outsideBtLocation}</Text>
              <Ionicons name="chevron-down-outline" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>{t.eventDate}</Text>
            <View style={styles.premiumInputGroup}>
              <Ionicons name="calendar-outline" size={15} color={theme.colors.textSecondary} style={styles.fieldIcon} />
              <TextInput style={styles.premiumField} value={state.eventDate} onChangeText={(val) => updateState('eventDate', val)} />
            </View>
          </View>
        </View>
      </View>

      {/* Premium Calculate Action Button */}
      <TouchableOpacity 
        style={styles.premiumCalculateBtn} 
        onPress={() => {
          if (onCalculate) {
            onCalculate();
          }
        }}
        activeOpacity={0.8}
      >
        <Ionicons name="calculator-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
        <Text style={styles.premiumCalculateBtnText}>
          {isTe ? "లెక్కించి 2D ప్లాన్ చూపించు" : "CALCULATE & GENERATE 2D PLAN"}
        </Text>
        <Ionicons name="chevron-forward-outline" size={16} color="#FFFFFF" style={{ marginLeft: 8 }} />
      </TouchableOpacity>

      {/* DROPDOWN PICKER */}
      <Modal visible={pickerVisible} transparent={true} animationType="fade" onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pickerTitle}</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)}>
                <Ionicons name="close" size={20} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={pickerData}
              keyExtractor={(item, index) => index.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.pickerItem} 
                  onPress={() => {
                    if (pickerField.startsWith("roomName_")) {
                      const id = pickerField.split("_")[1];
                      updateRoomValue(id, 'name', item);
                      setPickerVisible(false);
                    } else {
                      selectValue(item);
                    }
                  }}
                >
                  <Text style={styles.pickerItemText}>{item}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.modalDivider} />}
            />
          </View>
        </View>
      </Modal>

      {/* Vastu Footer (Web only) */}
      {Platform.OS === 'web' && !hideFooter && (
        <VastuFooter 
          language={language}
          theme={theme}
          activeTheme={state.activeTheme || 'light'} 
          style={{ marginHorizontal: -theme.spacing.gap, marginBottom: -110, marginTop: 40 }}
        />
      )}

    </ScrollView>
  );
}

const getStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.gap,
    paddingBottom: Platform.OS === 'web' ? 16 : 110,
  },
  dimStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: theme.radius.card,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.gap,
  },
  dimStep: {
    alignItems: 'center',
    gap: 4,
  },
  dimNode: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dimNodeActive: {
    borderColor: theme.colors.primary,
    backgroundColor: '#FFFFFF',
  },
  dimNodeInactive: {
    borderColor: theme.colors.border,
    backgroundColor: '#FFFFFF',
  },
  dimNodeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  dimLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  dimLabelActive: {
    color: theme.colors.primary,
  },
  dimLine: {
    flex: 1,
    height: 2,
    backgroundColor: theme.colors.border,
    marginHorizontal: 4,
  },
  metalSummaryCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: theme.colors.accent, // Gold accent border
    borderRadius: theme.radius.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: theme.spacing.gap,
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  summaryBadge: {
    flex: 1,
    alignItems: 'center',
  },
  summaryVertLine: {
    width: 1,
    height: 20,
    backgroundColor: theme.colors.accent,
    opacity: 0.5,
  },
  summaryBadgeLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  summaryBadgeVal: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.primary,
  },
  blueprintCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: theme.spacing.padding,
    marginBottom: theme.spacing.cardGap,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    position: 'relative',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    paddingBottom: 10,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardDesc: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  formGroup: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 6,
  },
  premiumInputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    height: 48,
    overflow: 'hidden',
  },
  premiumIconBadge: {
    width: 36,
    height: '100%',
    backgroundColor: theme.colors.primaryLight,
    borderRightWidth: 1.2,
    borderRightColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  premiumField: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
  },
  disabledField: {
    backgroundColor: theme.colors.primaryLight,
  },
  premiumSelect: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    height: 48,
  },
  selectLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectValText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
  },
  formRow: {
    flexDirection: 'row',
    gap: 16,
  },
  compassRoseOuter: {
    width: 120,
    height: 120,
    backgroundColor: theme.colors.primaryLight,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.primary,
    marginBottom: 8,
    marginTop: 4,
  },
  compassRoseRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  compassTextLabel: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '850',
    color: theme.colors.primary,
  },
  roseNeedleNorth: {
    position: 'absolute',
    top: 14,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderLeftColor: 'transparent',
    borderRightWidth: 5,
    borderRightColor: 'transparent',
    borderBottomWidth: 38,
    borderBottomColor: theme.colors.danger,
  },
  roseNeedleSouth: {
    position: 'absolute',
    bottom: 14,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderLeftColor: 'transparent',
    borderRightWidth: 5,
    borderRightColor: 'transparent',
    borderTopWidth: 38,
    borderTopColor: theme.colors.textSecondary,
  },
  roseCenterPin: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
  },
  roseAngleText: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: 6,
  },
  roseBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.primaryLight,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: theme.radius.button,
  },
  roseBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  blueprintRoomStamp: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  stampLeftBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: Platform.OS === 'web' ? 1.0 : 1.4,
    height: 38,
  },
  stampNameText: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.text,
  },
  stampDimContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Platform.OS === 'web' ? 8 : 6,
    flex: Platform.OS === 'web' ? 1.8 : 1.6,
    justifyContent: 'flex-end',
  },
  stampCoordInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 4,
    height: 32,
    width: Platform.OS === 'web' ? 80 : 48,
    backgroundColor: '#FFFFFF',
  },
  stampCoordLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.textSecondary,
    width: 14,
    textAlign: 'center',
  },
  stampCoordText: {
    flex: 1,
    height: '100%',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.text,
  },
  stampDeleteBtn: {
    padding: 4,
  },
  fullWidthAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    height: 48,
    marginTop: 12,
  },
  fullWidthAddText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 2, 98, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '50%',
    padding: theme.spacing.padding,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.text,
  },
  pickerItem: {
    paddingVertical: 12,
  },
  pickerItemText: {
    fontSize: 13,
    color: theme.colors.text,
  },
  modalDivider: {
    height: 1,
    backgroundColor: theme.colors.divider,
  },
  sliderContainer: {
    height: Platform.OS === 'web' ? 260 : 180,
    borderRadius: theme.radius.card,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: '#0F172A',
    position: 'relative',
  },
  sliderScroll: {
    flex: 1,
  },
  slideCard: {
    height: Platform.OS === 'web' ? 260 : 180,
    position: 'relative',
    overflow: 'hidden',
  },
  slideImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  slideOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  slideTextContainer: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
  },
  slideTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  slideDesc: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    lineHeight: 15,
  },
  sliderDots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  sliderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  activeDot: {
    backgroundColor: theme.colors.accent,
    width: 14,
  },
  inactiveDot: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  greetingCard: {
    backgroundColor: theme.colors.surface, // Matches standard card background
    borderRadius: theme.radius.card,
    padding: 16,
    marginBottom: 20,
    borderWidth: 0, // No border outline
  },
  greetingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  greetingTitle: {
    color: theme.colors.text, // High contrast black/dark text
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  greetingText: {
    color: theme.colors.textSecondary, // Soft dark grey description text
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  premiumCalculateBtn: {
    backgroundColor: '#070262', // Deep premium indigo
    borderWidth: 2,
    borderColor: '#FBBF24', // Gold border
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 26,
    shadowColor: '#070262',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  premiumCalculateBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 1.0,
  }
});
