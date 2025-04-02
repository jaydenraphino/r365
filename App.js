// App.js
import React, { useState, useEffect } from 'react';
import { Text, View, Alert, Platform, ScrollView, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from './services/supabaseClient';
import { getDistance } from 'geolib';

// Import your new screens:
import SignInScreen from './screens/SignInScreen';
import RoleSelectionScreen from './screens/RoleSelectionScreen';
import BystanderScreen from './screens/BystanderScreen';
import RescuerScreen from './screens/RescuerScreen';
import VetScreen from './screens/VetScreen';

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [location, setLocation] = useState(null);
  const [description, setDescription] = useState('');
  const [animalType, setAnimalType] = useState('');
  const [image, setImage] = useState(null);
  const [rescueReports, setRescueReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);

  // ------------------------
  // 1. AUTH & SESSION LOGIC this is just a test
  // ------------------------
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (data?.session) {
          setUser(data.session.user);
        } else if (error) {
          // Attempt refresh if there's an error
          const { data: refreshedSession } = await supabase.auth.refreshSession();
          if (refreshedSession?.session) {
            setUser(refreshedSession.session.user);
          }
        }
      } catch (err) {
        console.error("Error fetching session:", err);
      }
    };

    fetchSession();

    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      listener.subscription?.unsubscribe();
    };
  }, []);

  WebBrowser.maybeCompleteAuthSession();

  const handleGoogleSignIn = async () => {
    try {
      const redirectUri = Linking.createURL("/auth/callback");
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUri },
      });

      if (error) {
        console.error("Google Sign-In Error:", error);
        return;
      }

      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
        if (result.type === "success") {
          const { access_token, refresh_token } = extractTokensFromUrl(result.url);
          if (access_token && refresh_token) {
            const { data: sessionData } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (sessionData?.session) {
              setUser(sessionData.session.user);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error with Google Sign-In:", err);
    }
  };

  const extractTokensFromUrl = (url) => {
    const params = new URLSearchParams(url.split("#")[1]);
    return {
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
    };
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  useEffect(() => {
    const handleDeepLink = async ({ url }) => {
      const { access_token, refresh_token } = extractTokensFromUrl(url);
      if (access_token && refresh_token) {
        const { data: sessionData } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (sessionData?.session) {
          setUser(sessionData.session.user);
        }
      }
    };

    const subscription = Linking.addEventListener("url", handleDeepLink);
    return () => subscription.remove();
  }, []);

  // ------------------------
  // 2. LOCATION & IMAGE LOGIC
  // ------------------------
  const getLocation = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert("Permission to access location was denied");
      return;
    }
    let currentLocation = await Location.getCurrentPositionAsync({});
    const coords = {
      latitude: currentLocation.coords.latitude,
      longitude: currentLocation.coords.longitude,
    };
    const address = await Location.reverseGeocodeAsync(coords);

    setLocation({
      ...coords,
      address: `${address[0].name}, ${address[0].city}, ${address[0].region}`,
    });
  };

  const pickImage = async () => {
    Alert.alert("Choose an option", "Would you like to take a photo or upload one?", [
      {
        text: "Take a Photo",
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert("Permission Denied", "Camera permission is required.");
            return;
          }
          let result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 1,
          });
          if (!result.canceled) {
            setImage(result.assets[0].uri);
            Alert.alert("Photo Taken", "Your photo has been successfully taken.");
          }
        },
      },
      {
        text: "Upload from Gallery",
        onPress: async () => {
          let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 1,
          });
          if (!result.canceled) {
            setImage(result.assets[0].uri);
            Alert.alert("Image Selected", "Your photo has been successfully selected.");
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // ------------------------
  // 3. RESCUE REPORT LOGIC
  // ------------------------
  const submitRescueReport = async () => {
    if (!location || !description || !animalType || !image) {
      Alert.alert("Missing Information", "Please fill in all fields, add a photo, and get your location.");
      return;
    }
    const { data, error } = await supabase.from('rescue_reports').insert([
      {
        animal_type: animalType,
        description: description,
        location_lat: location.latitude,
        location_lng: location.longitude,
        address: location.address,
        image_url: image,
        status: "Pending",
      },
    ]);
    if (error) {
      console.error("Error submitting rescue report:", error);
      Alert.alert("Error", "There was an issue submitting the rescue report.");
    } else {
      Alert.alert("Report Submitted", "Your rescue report has been successfully submitted!");
      console.log(data);
    }
  };

  const navigateToLocation = (latitude, longitude) => {
    const url = Platform.select({
      ios: `maps://?q=${latitude},${longitude}`,
      android: `geo:${latitude},${longitude}`,
    });
    Linking.openURL(url);
  };

  const updateRescueStatus = async (reportId, status) => {
    const { data, error } = await supabase
      .from('rescue_reports')
      .update({ status })
      .eq('id', reportId);
    if (error) {
      console.error("Error updating rescue status:", error);
      Alert.alert("Error", "Unable to update rescue status.");
    } else {
      Alert.alert("Status Updated", `Rescue status set to "${status}".`);
      if (status === "Rescue Complete") {
        setRescueReports(currentReports =>
          currentReports.filter(report => report.id !== reportId)
        );
        Alert.alert("Bystander Notified", "The original reporter has been notified.");
      }
    }
  };

  const confirmRescue = (report) => {
    Alert.alert(
      "Confirm Rescue",
      `Are you sure you want to navigate to this location?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes",
          onPress: () => {
            navigateToLocation(report.location_lat, report.location_lng);
          },
        },
      ]
    );
  };

  // ------------------------
  // 4. FETCHING REPORTS FOR ROLES
  // ------------------------
  useEffect(() => {
    const fetchReports = async () => {
      const { data: reports, error } = await supabase.from('rescue_reports').select('*');
      if (error) {
        console.error("Error fetching rescue reports:", error);
        Alert.alert("Error", "Unable to fetch rescue reports.");
        return;
      }
      if (role === 'rescuer' && location) {
        const nearbyReports = reports.filter((report) => {
          const distance = getDistance(
            { latitude: location.latitude, longitude: location.longitude },
            { latitude: report.location_lat, longitude: report.location_lng }
          );
          return distance <= 10 * 1609.34 && report.status !== "Rescue Complete";
        });
        setRescueReports(nearbyReports);
      } else if (role === 'vet') {
        const inProgressReports = reports.filter((report) => report.status === "Rescue In Progress");
        setRescueReports(inProgressReports);
      }
    };

    if (role === 'rescuer' || role === 'vet') {
      fetchReports();
    }
  }, [role, location]);

  // ------------------------
  // 5. RENDER LOGIC
  // ------------------------
  // (A) If the user is not logged in, show SignInScreen
  if (!user) {
    return <SignInScreen handleGoogleSignIn={handleGoogleSignIn} />;
  }

  // (B) If user logged in but hasn't selected a role, show RoleSelectionScreen
  if (!role) {
    return (
      <RoleSelectionScreen
        setRole={setRole}
        handleSignOut={handleSignOut}
      />
    );
  }

  // (C) If user has selected a role, show the appropriate screen
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f0f8f5', padding: 20 }}>
      <View style={{ marginTop: 40, alignItems: 'center', marginBottom: 20 }}>
        <Text style={{ fontSize: 28, fontWeight: 'bold', color: '#3b7d3c', textAlign: 'center', marginBottom: 10 }}>
          Rescue365
        </Text>
        <Text style={{ fontSize: 20, color: '#4a4a4a', marginBottom: 20 }}>
          Your Role: {role.charAt(0).toUpperCase() + role.slice(1)}
        </Text>
      </View>

      {role === 'bystander' && (
        <BystanderScreen
          location={location}
          getLocation={getLocation}
          description={description}
          setDescription={setDescription}
          animalType={animalType}
          setAnimalType={setAnimalType}
          image={image}
          pickImage={pickImage}
          submitRescueReport={submitRescueReport}
        />
      )}

      {role === 'rescuer' && (
        <RescuerScreen
          rescueReports={rescueReports}
          selectedReport={selectedReport}
          setSelectedReport={setSelectedReport}
          confirmRescue={confirmRescue}
          updateRescueStatus={updateRescueStatus}
        />
      )}

      {role === 'vet' && (
        <VetScreen
          rescueReports={rescueReports}
          selectedReport={selectedReport}
          setSelectedReport={setSelectedReport}
          updateRescueStatus={updateRescueStatus}
        />
      )}

      <TouchableOpacity
        style={{ marginTop: 20 }}
        onPress={() => setRole(null)}
      >
        <Text style={{ color: '#3b7d3c', fontSize: 16, textDecorationLine: 'underline' }}>
          Change Role
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}