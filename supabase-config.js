/**
 * Supabase Configuration and Initialization
 * Connects the web application to the Supabase backend using the provided project credentials.
 */

// Supabase Project Credentials (URL and Anon Public Key)
const SUPABASE_URL = "https://evdsqwtzzbnsezhimgol.supabase.co";
const SUPABASE_KEY = "sb_publishable_jauXddTpjVU0x6PGuOkWLA_Pc8ZZzgu";

/**
 * Initializes the Supabase client if the library is loaded
 */
function createSupabaseClient() {
    // Ensure the Supabase global library is available from the CDN script tag
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('Supabase library failed to load before supabase-config.js');
        return null;
    }

    try {
        // Create and return the authenticated client instance
        return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (error) {
        console.error('Supabase client initialization failed:', error);
        return null;
    }
}

// Export credentials and client to the global window object for use in other scripts
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
window.supabaseClient = window.supabaseClient || createSupabaseClient();

/**
 * Utility: Verifies that the connection to Supabase is active and the API key is valid
 * by attempting a simple read operation on the 'users' table.
 */
async function verifySupabaseKey() {
    if (!window.supabaseClient) {
        alert('Supabase client is not initialized. Check your internet connection and confirm the Supabase library loaded.');
        return false;
    }

    // Test query to check authorization
    const { error } = await window.supabaseClient
        .from('users')
        .select('id')
        .limit(1);

    if (error) {
        console.error('Supabase key validation failed:', error);
        alert('Supabase API key is invalid or not authorized from this browser. Replace the key with your project anon public key from Supabase settings.');
        return false;
    }
    return true;
}

// Global Exports
window.verifySupabaseKey = verifySupabaseKey;
var supabaseClient = window.supabaseClient;
