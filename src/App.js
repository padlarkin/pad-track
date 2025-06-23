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

// Global variables provided by the Canvas environment
const firebaseConfig = {
  apiKey: "AIzaSyBKjzzPFrK850caNfbmUg75mfASWI9qYds",
  authDomain: "padtrack-4bb34.firebaseapp.com",
  projectId: "padtrack-4bb34",
  storageBucket: "padtrack-4bb34.firebasestorage.app",
  messagingSenderId: "993832125118",
  appId: "1:993832125118:web:02373aa87dd335463fd4ef"
};
// --- IMPORTANT: REPLACE WITH YOUR ACTUAL ALPHA VANTAGE API KEY ---
const ALPHA_VANTAGE_API_KEY = 'ZF0JX9NOR8FA39W7';
// --- END IMPORTANT ---


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
    if (!firebaseConfig) {
      setFirestoreError('Firebase configuration is missing.');
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
          // Sign in anonymously if no user is found
          try {
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

      return () => unsubscribe(); // Cleanup auth listener
    } catch (err) {
      console.error("Failed to initialize Firebase:", err);
      setFirestoreError(`Firebase initialization failed: ${err.message}`);
      setFirestoreLoading(false);
    }
  }, []); // Run only once on component mount

  // --- Firestore Portfolio Data Listener ---
  useEffect(() => {
    if (!db || !userId || !isAuthReady) {
      return; // Wait for Firestore and Auth to be ready
    }

    const portfolioCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/portfolios`);
    const unsubscribe = onSnapshot(portfolioCollectionRef, (snapshot) => {
      const fetchedPortfolios = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPortfolios(fetchedPortfolios);

      // If no active portfolio or current active portfolio was deleted, set a new one
      if (fetchedPortfolios.length > 0) {
        if (!activePortfolioId || !fetchedPortfolios.some(p => p.id === activePortfolioId)) {
          setActivePortfolioId(fetchedPortfolios[0].id); // Set the first portfolio as active
        }
      } else {
        // If no portfolios exist, create a default one
        createDefaultPortfolio();
      }
    }, (err) => {
      console.error("Error fetching portfolios from Firestore:", err);
      setFirestoreError(`Failed to load portfolios: ${err.message}`);
    });

    return () => unsubscribe(); // Cleanup snapshot listener
  }, [db, userId, isAuthReady, activePortfolioId]); // Re-run if db, userId, or auth state changes

  // --- Portfolio Management Functions ---
  const createDefaultPortfolio = async () => {
    if (!db || !userId) return;
    try {
      setFirestoreLoading(true);
      const portfolioCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/portfolios`);
      const newPortfolioRef = await addDoc(portfolioCollectionRef, {
        name: 'My First Portfolio',
        stocks: [], // Initialize with an empty array of stocks
        createdAt: new Date().toISOString(), // Store as ISO string
      });
      setActivePortfolioId(newPortfolioRef.id);
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
      setError('');
      const portfolioCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/portfolios`);
      const newPortfolioRef = await addDoc(portfolioCollectionRef, {
        name: newPortfolioName.trim(),
        stocks: [],
        createdAt: new Date().toISOString(), // Store as ISO string
      });
      setActivePortfolioId(newPortfolioRef.id);
      setNewPortfolioName(''); // Clear input
      setShowCreatePortfolioModal(false); // Close modal
      setFirestoreLoading(false);
    } catch (err) {
      console.error("Error creating new portfolio:", err);
      setFirestoreError(`Failed to create portfolio: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  const deletePortfolio = async (portfolioId) => {
    if (!db || !userId || !portfolioId) return;
    if (portfolios.length === 1 && portfolioId === activePortfolioId) {
        setError("Cannot delete the last portfolio. Create a new one first.");
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
    setStockData(null);
    setError('');
    setShowSuggestions(false);

    if (!stockSymbol.trim()) {
      setError('Please enter a stock symbol.');
      return;
    }
    if (!ALPHA_VANTAGE_API_KEY || ALPHA_VANTAGE_API_KEY === 'YOUR_ALPHA_VANTAGE_API_KEY') {
        setError('Please set your Alpha Vantage API Key in the code.');
        return;
    }

    setLoading(true);

    try {
      const apiUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${stockSymbol.toUpperCase()}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data["Error Message"]) {
        throw new Error(data["Error Message"]);
      }
      if (data["Note"]) { // Alpha Vantage rate limit message
          throw new Error(data["Note"]);
      }

      const quote = data["Global Quote"];

      if (quote && Object.keys(quote).length > 0) {
        const fetchedData = {
          symbol: quote["01. symbol"],
          companyName: quote["01. symbol"], // Alpha Vantage Global Quote doesn't provide company name directly
          price: parseFloat(quote["05. price"]).toFixed(2),
          // Fix: Ensure replace is called on string before parseFloat
          change: parseFloat(quote["09. change"]).toFixed(2),
          changePercent: parseFloat(String(quote["10. change percent"]).replace('%', '')).toFixed(2), // Ensured string conversion
          open: parseFloat(quote["02. open"]).toFixed(2),
          high: parseFloat(quote["03. high"]).toFixed(2),
          low: parseFloat(quote["04. low"]).toFixed(2),
          volume: parseInt(quote["06. volume"]).toLocaleString(),
          lastTradingDay: quote["07. latest trading day"],
          // P/E Ratio and Dividend Yield are not directly available from GLOBAL_QUOTE
          // Would require another API call (e.g., OVERVIEW endpoint) for real data
          peRatio: (Math.random() * 30 + 10).toFixed(2), // Dummy
          dividendYield: (Math.random() * 0.05).toFixed(4), // Dummy
          lastUpdated: new Date().toLocaleString()
        };
        setStockData(fetchedData);
      } else {
        setError(`No data found for symbol: ${stockSymbol.toUpperCase()}. Please check the symbol.`);
      }

    } catch (err) {
      console.error('Error fetching stock data:', err);
      setError(`Could not fetch data: ${err.message || 'Unknown error'}. Please try again, or check your API key/rate limits.`);
    } finally {
      setLoading(false);
    }
  };

  // --- Function to fetch stock suggestions with Alpha Vantage SYMBOL_SEARCH API ---
  const fetchSuggestions = async (query) => {
    if (query.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (!ALPHA_VANTAGE_API_KEY || ALPHA_VANTAGE_API_KEY === 'YOUR_ALPHA_VANTAGE_API_KEY') {
        // Don't error out on suggestions if API key is missing, just don't fetch
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
          // console.warn("Alpha Vantage Note for suggestions:", data["Note"]);
          // We can still show old suggestions or just clear them
          setSuggestions([]);
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
      // set error state or just log for suggestions as it's less critical
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // Handle input change for autosuggestion
  const handleInputChange = (e) => {
    const value = e.target.value;
    setStockSymbol(value);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  };

  // Handle clicking on a suggestion (unchanged)
  const handleSuggestionClick = (symbol) => {
    setStockSymbol(symbol);
    setSuggestions([]);
    setShowSuggestions(false);
    // Optionally trigger fetch data immediately after selecting a suggestion
    // fetchStockData(); // Uncomment if you want immediate fetch
  };

  // Handle clicking outside the input and suggestions to close them (unchanged)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (inputContainerRef.current && !inputContainerRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Function to add the current stock to the active portfolio
  const addToPortfolio = async () => {
    if (!stockData || !db || !userId || !activePortfolioId) {
      setError("Please fetch stock data and ensure a portfolio is selected.");
      return;
    }

    try {
      setFirestoreLoading(true);
      setError('');
      const activePortfolio = portfolios.find(p => p.id === activePortfolioId);
      if (activePortfolio) {
        const isAlreadyInPortfolio = activePortfolio.stocks.some(item => item.symbol === stockData.symbol);
        if (!isAlreadyInPortfolio) {
          const portfolioDocRef = doc(db, `artifacts/${appId}/users/${userId}/portfolios`, activePortfolioId);
          await setDoc(portfolioDocRef, {
            ...activePortfolio,
            stocks: [...activePortfolio.stocks, stockData]
          }, { merge: true });
        } else {
          setError(`${stockData.symbol} is already in the active portfolio.`);
        }
      }
      setFirestoreLoading(false);
    } catch (err) {
      console.error("Error adding stock to portfolio:", err);
      setFirestoreError(`Failed to add stock to portfolio: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  // Function to remove a stock from the active portfolio
  const removeFromPortfolio = async (symbolToRemove) => {
    if (!db || !userId || !activePortfolioId) return;

    try {
      setFirestoreLoading(true);
      setError('');
      const activePortfolio = portfolios.find(p => p.id === activePortfolioId);
      if (activePortfolio) {
        const updatedStocks = activePortfolio.stocks.filter(stock => stock.symbol !== symbolToRemove);
        const portfolioDocRef = doc(db, `artifacts/${appId}/users/${userId}/portfolios`, activePortfolioId);
        await setDoc(portfolioDocRef, {
          ...activePortfolio,
          stocks: updatedStocks
        }, { merge: true });
      }
      setFirestoreLoading(false);
    } catch (err) {
      console.error("Error removing stock from portfolio:", err);
      setFirestoreError(`Failed to remove stock: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e, stock) => {
    setDraggedItem(stock);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', stock.symbol);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, targetStock) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.symbol === targetStock.symbol) {
      setDraggedItem(null);
      return;
    }

    const currentPortfolio = portfolios.find(p => p.id === activePortfolioId);
    if (!currentPortfolio) return;

    const updatedStocks = [...currentPortfolio.stocks];
    const draggedIndex = updatedStocks.findIndex(stock => stock.symbol === draggedItem.symbol);
    const targetIndex = updatedStocks.findIndex(stock => stock.symbol === targetStock.symbol);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedItem(null);
      return;
    }

    const [removed] = updatedStocks.splice(draggedIndex, 1);
    updatedStocks.splice(targetIndex, 0, removed);

    try {
      setFirestoreLoading(true);
      setError('');
      const portfolioDocRef = doc(db, `artifacts/${appId}/users/${userId}/portfolios`, activePortfolioId);
      await setDoc(portfolioDocRef, {
        ...currentPortfolio,
        stocks: updatedStocks
      }, { merge: true });
      setFirestoreLoading(false);
      setDraggedItem(null);
    } catch (err) {
      console.error("Error reordering portfolio:", err);
      setFirestoreError(`Failed to reorder portfolio: ${err.message}`);
      setFirestoreLoading(false);
    }
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  // Get the active portfolio's stocks for display
  const activePortfolioStocks = activePortfolioId
    ? portfolios.find(p => p.id === activePortfolioId)?.stocks || []
    : [];

  // Loading and Error states for Firebase
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
        <h1 className="text-4xl font-extrabold mb-2 text-shadow-lg">Pad Trac</h1>
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
        {/* Portfolio Management */}
        <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold text-indigo-700">Manage Portfolios</h2>
            <div className="flex flex-col sm:flex-row gap-2 items-center">
                <select
                    className="flex-grow p-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-800 text-lg shadow-sm"
                    value={activePortfolioId || ''}
                    onChange={(e) => setActivePortfolioId(e.target.value)}
                >
                    {portfolios.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    {portfolios.length === 0 && <option value="" disabled>No portfolios</option>}
                </select>
                <button
                    onClick={() => setShowCreatePortfolioModal(true)}
                    className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition duration-300 ease-in-out active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 text-sm"
                >
                    New Portfolio
                </button>
                {activePortfolioId && portfolios.length > 0 && (
                    <button
                        onClick={() => deletePortfolio(activePortfolioId)}
                        className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transform transition duration-300 ease-in-out active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 text-sm"
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
                        >
                            Cancel
                        </button>
                        <button
                            onClick={createNewPortfolio}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out"
                        >
                            Create
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Stock Search Input */}
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
                if (stockSymbol.length > 0 && suggestions.length > 0) {
                    setShowSuggestions(true);
                }
            }}
          />
          <button
            onClick={fetchStockData}
            className="bg-indigo-700 hover:bg-indigo-800 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            disabled={loading}
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

        {error && (
          <p className="text-red-500 bg-red-100 p-3 rounded-lg border border-red-200 text-center shadow-md">
            {error}
          </p>
        )}

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
              disabled={!activePortfolioId || firestoreLoading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Add to Active Portfolio
            </button>
            <p className="text-sm text-gray-600 italic mt-4">Data is from Alpha Vantage. P/E and Dividend Yield are mock.</p>
          </div>
        )}
      </div>

      {activePortfolioStocks.length > 0 && (
        <div className="w-full max-w-md bg-white p-6 rounded-xl shadow-2xl space-y-4 mt-8">
          <h2 className="text-3xl font-bold text-indigo-700 mb-4 text-center">
            {portfolios.find(p => p.id === activePortfolioId)?.name || 'My Portfolio'}
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {activePortfolioStocks.map((stock) => (
              <div
                key={stock.symbol}
                draggable="true" // Make the item draggable
                onDragStart={(e) => handleDragStart(e, stock)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stock)}
                onDragEnd={handleDragEnd}
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
                  disabled={firestoreLoading}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        /* Custom styles for text shadow */
        .text-shadow-lg {
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
        }
      `}</style>
      <script src="https://cdn.tailwindcss.com"></script>
    </div>
  );
}
