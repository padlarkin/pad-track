import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  collection,
} from 'firebase/firestore';

// --- IMPORTANT: YOUR ALPHA VANTAGE API KEY ---
const ALPHA_VANTAGE_API_KEY = 'ZF0JX9NOR8FA39W7';
// --- END IMPORTANT ---

// --- YOUR ACTUAL FIREBASE CONFIGURATION ---
// This configuration is specific to your 'padtrack-4bb34' Firebase project.
const firebaseConfig = {
  apiKey: "AIzaSyBKjzzPFrK850caNfbmUg75mfASWI9qYds",
  authDomain: "padtrack-4bb34.firebaseapp.com",
  projectId: "padtrack-4bb34",
  storageBucket: "padtrack-4bb34.firebasestorage.app",
  messagingSenderId: "993832125118",
  appId: "1:993832125118:web:02373aa87dd335463fd4ef"
};
// --- END FIREBASE CONFIGURATION ---

// For local deployment, we'll use the Firebase Project ID as the app ID.
// This ensures consistency with the Firestore path /artifacts/{appId}/users/{userId}/portfolios.
const appId = firebaseConfig.projectId;

// The __initial_auth_token is only provided by the Canvas environment, not needed for deployed apps.
// The Firebase auth logic in useEffect handles anonymous sign-in directly.
const initialAuthToken = null;


// Main App component
export default function App() {
  const [stockSymbol, setStockSymbol] = useState('');
  const [stockData, setStockData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Firestore & Auth states
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [firestoreLoading, setFirestoreLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState('');

  // Portfolio states
  const [portfolios, setPortfolios] = useState([]);
  const [activePortfolioId, setActivePortfolioId] = useState(null);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [showCreatePortfolioModal, setShowCreatePortfolioModal] = useState(false);

  // Drag and Drop states
  const [draggedItem, setDraggedItem] = useState(null); // To store the stock object being dragged

  // Ref to hold the debounce timeout ID
  const debounceTimeoutRef = useRef(null);
  // Ref for the input element and its container to handle blur correctly
  const inputContainerRef = useRef(null); // Ref for the div containing input and button


  // --- Firebase Initialization and Authentication ---
  useEffect(() => {
    // Check if Firebase configuration is complete before initializing
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
      setFirestoreError('Firebase configuration is missing or incomplete. Please ensure all values are set.');
      setFirestoreLoading(false);
      return;
    }

    try {
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
          setIsAuthReady(true);
        } else {
          // Sign in anonymously if no user is found and no initialAuthToken
          try {
            // initialAuthToken is null for deployed apps, so it will proceed to signInAnonymously
            if (initialAuthToken) {
                await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } else {
                await signInAnonymously(firebaseAuth);
            }
          } catch (anonError) {
            console.error("Error signing in anonymously:", anonError);
            setFirestoreError(`Authentication error: ${anonError.message}`);
          }
        }
        setFirestoreLoading(false);
      });

      return () => unsubscribe(); // Cleanup auth listener when component unmounts
    } catch (err) {
      console.error("Failed to initialize Firebase:", err);
      setFirestoreError(`Firebase initialization failed: ${err.message}. Please check your Firebase config.`);
      setFirestoreLoading(false);
    }
  }, []); // Empty dependency array means this effect runs once on mount

  // --- Firestore Portfolio Data Listener ---
  useEffect(() => {
    // Only proceed if Firestore (db), Auth (userId), and Auth readiness are confirmed
    if (!db || !userId || !isAuthReady) {
      return;
    }

    const portfolioCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/portfolios`);
    const unsubscribe = onSnapshot(portfolioCollectionRef, (snapshot) => {
      const fetchedPortfolios = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPortfolios(fetchedPortfolios);

      // Logic to set/create active portfolio
      if (fetchedPortfolios.length > 0) {
        // If an active portfolio is set, ensure it still exists. If not, pick the first one.
        if (!activePortfolioId || !fetchedPortfolios.some(p => p.id === activePortfolioId)) {
          setActivePortfolioId(fetchedPortfolios[0].id);
        }
      } else {
        // If no portfolios exist, automatically create a default one
        createDefaultPortfolio();
      }
    }, (err) => {
      console.error("Error fetching portfolios from Firestore:", err);
      setFirestoreError(`Failed to load portfolios: ${err.message}`);
    });

    return () => unsubscribe(); // Cleanup snapshot listener when component unmounts or dependencies change
  }, [db, userId, isAuthReady, activePortfolioId]); // Re-run if db, userId, authReady state, or activePortfolioId changes

  // --- Portfolio Management Functions ---
  const createDefaultPortfolio = async () => {
    if (!db || !userId) return; // Ensure Firestore and user are ready
    try {
      setFirestoreLoading(true);
      const portfolioCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/portfolios`);
      const newPortfolioRef = await addDoc(portfolioCollectionRef, {
        name: 'My First Portfolio',
        stocks: [], // Initialize with an empty array of stocks
        createdAt: new Date().toISOString(), // Store as ISO string for sorting/consistency
      });
      setActivePortfolioId(newPortfolioRef.id); // Set the newly created portfolio as active
      setFirestoreLoading(false);
    } catch (err) {
      console.error("Error creating default portfolio:", err);
      setFirestoreError(`Failed to create default portfolio: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  const createNewPortfolio = async () => {
    if (!db || !userId || !newPortfolioName.trim()) {
      setError("Portfolio name cannot be empty.");
      return;
    }
    try {
      setFirestoreLoading(true);
      setError(''); // Clear previous errors
      const portfolioCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/portfolios`);
      const newPortfolioRef = await addDoc(portfolioCollectionRef, {
        name: newPortfolioName.trim(),
        stocks: [],
        createdAt: new Date().toISOString(),
      });
      setActivePortfolioId(newPortfolioRef.id); // Set the newly created portfolio as active
      setNewPortfolioName(''); // Clear input field
      setShowCreatePortfolioModal(false); // Close the modal
      setFirestoreLoading(false);
    } catch (err) {
      console.error("Error creating new portfolio:", err);
      setFirestoreError(`Failed to create portfolio: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  const deletePortfolio = async (portfolioId) => {
    if (!db || !userId || !portfolioId) return; // Ensure Firestore, user, and portfolio ID are valid
    // Prevent deleting the last remaining portfolio
    if (portfolios.length === 1 && portfolioId === activePortfolioId) {
        setError("Cannot delete the last portfolio. Please create a new one before deleting this.");
        return;
    }
    try {
      setFirestoreLoading(true);
      setError('');
      await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/portfolios`, portfolioId));
      setFirestoreLoading(false);
    } catch (err) {
      console.error("Error deleting portfolio:", err);
      setFirestoreError(`Failed to delete portfolio: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  // --- Stock Data Fetching with Alpha Vantage API ---
  const fetchStockData = async () => {
    setStockData(null); // Clear previous stock data display
    setError('');       // Clear previous errors
    setShowSuggestions(false); // Hide suggestions

    if (!stockSymbol.trim()) {
      setError('Please enter a stock symbol.');
      return;
    }
    // Basic check if API key is still the placeholder
    if (!ALPHA_VANTAGE_API_KEY || ALPHA_VANTAGE_API_KEY === 'YOUR_ALPHA_VANTAGE_API_KEY') {
        setError('Alpha Vantage API Key is missing. Please update it in the code.');
        return;
    }

    setLoading(true); // Set loading state for stock data fetch

    try {
      const apiUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${stockSymbol.toUpperCase()}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      // Handle Alpha Vantage specific error messages
      if (data["Error Message"]) {
        throw new Error(data["Error Message"]);
      }
      if (data["Note"]) { // This often indicates rate limit
          throw new Error(data["Note"]);
      }

      const quote = data["Global Quote"]; // Access the 'Global Quote' object from the response

      if (quote && Object.keys(quote).length > 0) {
        // Parse and format the fetched data
        const fetchedData = {
          symbol: quote["01. symbol"],
          companyName: match.name, // Use the name from the symbol search or a placeholder
          price: parseFloat(quote["05. price"]).toFixed(2),
          change: parseFloat(quote["09. change"]).toFixed(2),
          // Ensure replace is called on string before parseFloat
          changePercent: parseFloat(quote["10. change percent"].replace('%', '')).toFixed(2),
          open: parseFloat(quote["02. open"]).toFixed(2),
          high: parseFloat(quote["03. high"]).toFixed(2),
          low: parseFloat(quote["04. low"]).toFixed(2),
          volume: parseInt(quote["06. volume"]).toLocaleString(),
          lastTradingDay: quote["07. latest trading day"],
          // P/E Ratio and Dividend Yield are not directly available from GLOBAL_QUOTE.
          // For real data, you'd need the OVERVIEW endpoint. Keeping as dummy for now.
          peRatio: (Math.random() * 30 + 10).toFixed(2),
          dividendYield: (Math.random() * 0.05).toFixed(4),
          lastUpdated: new Date().toLocaleString()
        };
        // Attempt to find the company name from suggestions if possible
        const companyMatch = suggestions.find(s => s.symbol === fetchedData.symbol);
        if (companyMatch) {
            fetchedData.companyName = companyMatch.name;
        } else {
            // Fallback if no match found (e.g., direct symbol input without suggestions)
            fetchedData.companyName = `${fetchedData.symbol} Inc.`;
        }

        setStockData(fetchedData);
      } else {
        setError(`No live data found for symbol: ${stockSymbol.toUpperCase()}. Please check the symbol or try again later.`);
      }

    } catch (err) {
      console.error('Error fetching stock data:', err);
      setError(`Could not fetch data: ${err.message || 'Unknown API error'}. Please try again, or check your API key/rate limits.`);
    } finally {
      setLoading(false); // End loading state
    }
  };

  // --- Function to fetch stock suggestions with Alpha Vantage SYMBOL_SEARCH API ---
  const fetchSuggestions = async (query) => {
    if (query.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    // Don't error out on suggestions if API key is missing, just don't fetch from API
    if (!ALPHA_VANTAGE_API_KEY || ALPHA_VANTAGE_API_KEY === 'YOUR_ALPHA_VANTAGE_API_KEY') {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
    }

    try {
      const apiUrl = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${query}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data["Error Message"]) {
        throw new Error(data["Error Message"]);
      }
      if (data["Note"]) { // Alpha Vantage rate limit message
          // console.warn("Alpha Vantage Note for suggestions:", data["Note"]); // Log warning but don't stop flow
          setSuggestions([]); // Clear suggestions if rate limited
          setShowSuggestions(false);
          return;
      }

      if (data.bestMatches) {
        const newSuggestions = data.bestMatches.slice(0, 5).map(match => ({
          symbol: match["1. symbol"],
          name: match["2. name"]
        }));
        setSuggestions(newSuggestions);
        setShowSuggestions(newSuggestions.length > 0);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }

    } catch (err) {
      console.error('Error fetching suggestions:', err);
      // For suggestions, just clear them on error, not critical to stop app
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // Debounce logic for input change to limit API calls for suggestions
  const handleInputChange = (e) => {
    const value = e.target.value;
    setStockSymbol(value);

    // Clear any existing debounce timer
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set a new timer to call fetchSuggestions after a delay
    debounceTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300); // 300ms debounce
  };

  // Handle clicking on a suggestion item from the dropdown
  const handleSuggestionClick = (symbol) => {
    setStockSymbol(symbol); // Populate the input with the selected symbol
    setSuggestions([]); // Clear the suggestion list
    setShowSuggestions(false); // Hide the suggestion dropdown
    // Optionally, automatically fetch stock data after selection:
    // fetchStockData();
  };

  // Close suggestions when clicking outside the input/suggestions area
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (inputContainerRef.current && !inputContainerRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside); // Cleanup event listener
    };
  }, []); // Empty dependency array means this effect runs once on mount


  // Function to add the currently displayed stock data to the active portfolio in Firestore
  const addToPortfolio = async () => {
    if (!stockData || !db || !userId || !activePortfolioId) {
      setError("Please fetch stock data and ensure an active portfolio is selected.");
      return;
    }

    try {
      setFirestoreLoading(true); // Indicate Firestore operation is ongoing
      setError(''); // Clear previous errors
      const activePortfolio = portfolios.find(p => p.id === activePortfolioId); // Find the current active portfolio object
      if (activePortfolio) {
        // Check if the stock is already in the current portfolio to prevent duplicates
        const isAlreadyInPortfolio = activePortfolio.stocks.some(item => item.symbol === stockData.symbol);
        if (!isAlreadyInPortfolio) {
          const portfolioDocRef = doc(db, `artifacts/${appId}/users/${userId}/portfolios`, activePortfolioId);
          // Update the Firestore document with the new stock added to the 'stocks' array
          await setDoc(portfolioDocRef, {
            ...activePortfolio, // Spread existing fields to retain them
            stocks: [...activePortfolio.stocks, stockData] // Add the new stock to the array
          }, { merge: true }); // Use merge: true to only update the 'stocks' field and not overwrite the entire document
        } else {
          setError(`${stockData.symbol} is already in the active portfolio.`); // Inform user about duplicate
        }
      }
      setFirestoreLoading(false); // End Firestore loading
    } catch (err) {
      console.error("Error adding stock to portfolio:", err);
      setFirestoreError(`Failed to add stock to portfolio: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  // Function to remove a stock from the active portfolio in Firestore
  const removeFromPortfolio = async (symbolToRemove) => {
    if (!db || !userId || !activePortfolioId) return; // Ensure Firestore, user, and portfolio are ready

    try {
      setFirestoreLoading(true); // Indicate Firestore operation is ongoing
      setError(''); // Clear previous errors
      const activePortfolio = portfolios.find(p => p.id === activePortfolioId); // Find the current active portfolio
      if (activePortfolio) {
        // Filter out the stock to be removed from the stocks array
        const updatedStocks = activePortfolio.stocks.filter(stock => stock.symbol !== symbolToRemove);
        const portfolioDocRef = doc(db, `artifacts/${appId}/users/${userId}/portfolios`, activePortfolioId);
        // Update the Firestore document with the modified stocks array
        await setDoc(portfolioDocRef, {
          ...activePortfolio,
          stocks: updatedStocks
        }, { merge: true });
      }
      setFirestoreLoading(false); // End Firestore loading
    } catch (err) {
      console.error("Error removing stock from portfolio:", err);
      setFirestoreError(`Failed to remove stock: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  // --- Drag and Drop Handlers for reordering portfolio stocks ---
  const handleDragStart = (e, stock) => {
    setDraggedItem(stock); // Store the item being dragged in state
    e.dataTransfer.effectAllowed = 'move'; // Visual feedback for move operation
    e.dataTransfer.setData('text/plain', stock.symbol); // Pass data for the drop target
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // Prevent default to allow drop
    e.dataTransfer.dropEffect = 'move'; // Visual feedback for move operation
  };

  const handleDrop = async (e, targetStock) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.symbol === targetStock.symbol) {
      setDraggedItem(null); // Clear dragged item if no valid drag or dropping on self
      return;
    }

    const currentPortfolio = portfolios.find(p => p.id === activePortfolioId);
    if (!currentPortfolio) return;

    const updatedStocks = [...currentPortfolio.stocks]; // Create a mutable copy of stocks array
    const draggedIndex = updatedStocks.findIndex(stock => stock.symbol === draggedItem.symbol);
    const targetIndex = updatedStocks.findIndex(stock => stock.symbol === targetStock.symbol);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedItem(null); // Clear if indices are invalid
      return;
    }

    // Perform the reordering logic:
    const [removed] = updatedStocks.splice(draggedIndex, 1); // Remove the dragged item
    updatedStocks.splice(targetIndex, 0, removed); // Insert it at the target position

    // Update Firestore with the new order
    try {
      setFirestoreLoading(true);
      setError('');
      const portfolioDocRef = doc(db, `artifacts/${appId}/users/${userId}/portfolios`, activePortfolioId);
      await setDoc(portfolioDocRef, {
        ...currentPortfolio, // Keep other portfolio properties
        stocks: updatedStocks // Update with the reordered array
      }, { merge: true });
      setFirestoreLoading(false);
      setDraggedItem(null); // Clear dragged item after successful update
    } catch (err) {
      console.error("Error reordering portfolio:", err);
      setFirestoreError(`Failed to reorder portfolio: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  const handleDragEnd = () => {
    setDraggedItem(null); // Clear dragged item state regardless of drop success
  };

  // Derive the stocks for the currently active portfolio for display
  const activePortfolioStocks = activePortfolioId
    ? portfolios.find(p => p.id === activePortfolioId)?.stocks || []
    : [];

  // --- Conditional Rendering for Loading and Error States ---
  if (firestoreLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-800 text-white flex flex-col items-center justify-center font-sans">
        <svg className="animate-spin h-10 w-10 text-white mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-xl">Loading application and portfolios...</p>
        {firestoreError && <p className="text-red-300 mt-4">{firestoreError}</p>}
      </div>
    );
  }

  if (firestoreError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-800 text-white flex flex-col items-center justify-center font-sans p-4">
        <h1 className="text-3xl font-bold mb-4">Error</h1>
        <p className="text-red-300 text-center">{firestoreError}</p>
        <p className="text-indigo-200 mt-4">Please ensure Firebase configuration is correct and try again.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-800 text-white p-4 sm:p-6 flex flex-col items-center justify-center font-sans">
      <header className="w-full max-w-lg mb-4 text-center">
        <h1 className="text-4xl font-extrabold mb-2 text-shadow-lg">Stock Data Fetcher</h1>
        <p className="text-indigo-200 text-sm">
          Your User ID: <span className="font-mono text-xs break-all bg-indigo-500 bg-opacity-30 rounded px-1">{userId || 'N/A'}</span>
        </p>
        <p className="text-indigo-200">
          Start typing to see stock suggestions from Alpha Vantage. Select one or enter a symbol to get live data.
          <br/>
          (Portfolio is saved to cloud.)
        </p>
      </header>

      <div className="w-full max-w-md bg-white p-6 rounded-xl shadow-2xl space-y-6 mb-8">
        {/* Portfolio Management Section */}
        <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold text-indigo-700">Manage Portfolios</h2>
            <div className="flex flex-col sm:flex-row gap-2 items-center">
                <select
                    className="flex-grow p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-800 text-lg shadow-sm"
                    value={activePortfolioId || ''}
                    onChange={(e) => setActivePortfolioId(e.target.value)}
                    disabled={firestoreLoading} // Disable while Firestore operations are ongoing
                >
                    {portfolios.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    {portfolios.length === 0 && <option value="" disabled>No portfolios</option>}
                </select>
                <button
                    onClick={() => setShowCreatePortfolioModal(true)}
                    className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition duration-300 ease-in-out active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 text-sm"
                    disabled={firestoreLoading}
                >
                    New Portfolio
                </button>
                {activePortfolioId && portfolios.length > 0 && (
                    <button
                        onClick={() => deletePortfolio(activePortfolioId)}
                        className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition duration-300 ease-in-out active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 text-sm"
                        disabled={firestoreLoading || portfolios.length === 1} // Disable if only one portfolio left
                    >
                        Delete Active
                    </button>
                )}
            </div>
            {activePortfolioId && portfolios.length > 0 && (
                <p className="text-sm text-gray-600">Active Portfolio: <span className="font-semibold">{portfolios.find(p => p.id === activePortfolioId)?.name}</span></p>
            )}
        </div>

        {/* Create Portfolio Modal */}
        {showCreatePortfolioModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white p-6 rounded-lg shadow-xl text-gray-800 w-full max-w-sm space-y-4">
                    <h3 className="text-xl font-bold text-indigo-700">Create New Portfolio</h3>
                    <input
                        type="text"
                        className="w-full p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-lg shadow-sm"
                        placeholder="Enter portfolio name"
                        value={newPortfolioName}
                        onChange={(e) => setNewPortfolioName(e.target.value)}
                        onKeyPress={(e) => { if (e.key === 'Enter') createNewPortfolio(); }}
                    />
                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => setShowCreatePortfolioModal(false)}
                            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                            disabled={firestoreLoading}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={createNewPortfolio}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                            disabled={firestoreLoading}
                        >
                            Create
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Stock Search Input Section */}
        <div className="flex flex-col sm:flex-row gap-4 relative" ref={inputContainerRef}>
          <input
            type="text"
            className="flex-grow p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-800 text-lg shadow-sm"
            placeholder="Enter stock symbol (e.g., AAPL)"
            value={stockSymbol}
            onChange={handleInputChange}
            onKeyPress={(e) => {
                if (e.key === 'Enter') {
                    fetchStockData();
                }
            }}
            onFocus={() => {
                // Show suggestions on focus if there's text and suggestions available
                if (stockSymbol.length > 0 && suggestions.length > 0) {
                    setShowSuggestions(true);
                }
            }}
          />
          <button
            onClick={fetchStockData}
            className="bg-indigo-700 hover:bg-indigo-800 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            disabled={loading} // Disable if stock data is currently being fetched
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 text-white inline-block mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              'Get Stock Data'
            )}
          </button>

          {/* Autosuggestion List */}
          {showSuggestions && suggestions.length > 0 && (
            <ul className="suggestions-list absolute z-10 left-0 right-0 w-full bg-white border border-gray-300 rounded-lg shadow-lg top-[calc(100%+0.5rem)] max-h-60 overflow-y-auto text-gray-800">
              {suggestions.map((stock) => (
                <li
                  key={stock.symbol}
                  className="p-3 hover:bg-indigo-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                  onClick={() => handleSuggestionClick(stock.symbol)}
                >
                  <span className="font-semibold">{stock.symbol}</span> - {stock.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* General Error Message Display */}
        {error && (
          <p className="text-red-500 bg-red-100 p-3 rounded-lg border border-red-200 text-center shadow-md">
            {error}
          </p>
        )}

        {/* Display Fetched Stock Data */}
        {stockData && (
          <div className="bg-gradient-to-r from-gray-50 to-gray-100 p-6 rounded-xl shadow-lg border border-gray-200 text-gray-800 space-y-4">
            <h2 className="text-3xl font-bold text-indigo-700 mb-2">{stockData.companyName}</h2>
            <p className="text-2xl font-extrabold">
              Price: <span className="text-green-600">${stockData.price}</span>
            </p>
            <p className={`text-xl font-semibold ${stockData.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              Change: {stockData.change >= 0 ? '+' : ''}${stockData.change} ({stockData.changePercent}%)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-lg">
              <p><strong>Symbol:</strong> {stockData.symbol}</p>
              <p><strong>Market Cap:</strong> ${stockData.marketCap}</p>
              <p><strong>Volume:</strong> {stockData.volume}</p>
              <p><strong>P/E Ratio:</strong> {stockData.peRatio}</p>
              <p><strong>Dividend Yield:</strong> {(parseFloat(stockData.dividendYield) * 100).toFixed(2)}%</p>
              <p><strong>Last Updated:</strong> {stockData.lastUpdated}</p>
            </div>
            <button
              onClick={addToPortfolio}
              className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out active:scale-95 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 flex items-center justify-center gap-2"
              disabled={!activePortfolioId || firestoreLoading} // Disable if no active portfolio or Firestore is busy
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Add to Active Portfolio
            </button>
            <p className="text-sm text-gray-600 italic mt-4">Data is from Alpha Vantage. P/E and Dividend Yield are mock as they require another API call.</p>
          </div>
        )}
      </div>

      {/* My Portfolio Section */}
      {activePortfolioStocks.length > 0 && (
        <div className="w-full max-w-md bg-white p-6 rounded-xl shadow-2xl space-y-4 mt-8">
          <h2 className="text-3xl font-bold text-indigo-700 mb-4 text-center">
            {portfolios.find(p => p.id === activePortfolioId)?.name || 'My Portfolio'}
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {activePortfolioStocks.map((stock) => (
              <div
                key={stock.symbol}
                draggable="true" // Makes this element draggable
                onDragStart={(e) => handleDragStart(e, stock)} // Event when drag starts
                onDragOver={handleDragOver} // Event when dragged item is over this
                onDrop={(e) => handleDrop(e, stock)} // Event when dragged item is dropped on this
                onDragEnd={handleDragEnd} // Event when drag ends
                // Visual feedback for dragged item
                className={`bg-gray-50 p-4 rounded-lg shadow-md border border-gray-200 text-gray-800 flex justify-between items-center cursor-grab ${draggedItem && draggedItem.symbol === stock.symbol ? 'opacity-50 border-blue-500 border-2' : ''}`}
              >
                <div>
                  <h3 className="text-xl font-bold text-indigo-600">{stock.symbol}</h3>
                  <p className="text-sm text-gray-600">{stock.companyName}</p>
                  <p className="text-lg font-semibold mt-1">Price: <span className="text-green-600">${stock.price}</span></p>
                  <p className={`text-md ${stock.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {stock.change >= 0 ? '+' : ''}${stock.change} ({stock.changePercent}%)
                  </p>
                </div>
                <button
                  onClick={() => removeFromPortfolio(stock.symbol)}
                  className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition duration-300 ease-in-out active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 text-sm"
                  disabled={firestoreLoading} // Disable while Firestore operations are ongoing
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tailwind CSS and Custom Styles */}
      <style jsx>{`
        /* Custom styles for text shadow on header */
        .text-shadow-lg {
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
        }
      `}</style>
      <script src="https://cdn.tailwindcss.com"></script>
    </div>
  );
}
