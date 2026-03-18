let count = 0;
let authToken = null;
let currentUser = null;

const API_BASE = '/api';

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : ''
    };
}

function showMessage(elementId, message, isError = false) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.style.display = 'block';
        element.className = isError ? 'error-message' : 'success-message';
    }
}

function hideMessage(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = 'none';
        element.textContent = '';
    }
}

function clearMessages() {
    document.querySelectorAll('.error-message, .success-message').forEach(el => {
        el.style.display = 'none';
        el.textContent = '';
    });
}

function updateUI() {
    const loggedOut = document.getElementById('auth-logged-out');
    const loggedIn = document.getElementById('auth-logged-in');
    const mainContent = document.getElementById('main-content');
    const userEmail = document.getElementById('user-email');

    if (authToken && currentUser) {
        loggedOut.style.display = 'none';
        loggedIn.style.display = 'block';
        mainContent.style.display = 'grid';
        if (userEmail) {
            userEmail.textContent = currentUser.email;
        }
        loadCount();
    } else {
        loggedOut.style.display = 'block';
        loggedIn.style.display = 'none';
        mainContent.style.display = 'none';
        authToken = null;
        currentUser = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
    }
}

async function signUp(email, password) {
    try {
        const response = await fetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to create account');
        }

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('user', JSON.stringify(currentUser));

        showMessage('signup-success', 'Account created successfully!');
        setTimeout(() => {
            updateUI();
        }, 1000);

        return data;
    } catch (error) {
        throw error;
    }
}

async function signIn(email, password) {
    try {
        const response = await fetch(`${API_BASE}/auth/signin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to sign in');
        }

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('user', JSON.stringify(currentUser));

        showMessage('signin-success', 'Successfully signed in!');
        setTimeout(() => {
            updateUI();
        }, 1000);

        return data;
    } catch (error) {
        throw error;
    }
}

function signOut() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    updateUI();
    clearMessages();
}

async function loadCount() {
    if (!authToken) return;

    try {
        const response = await fetch(`${API_BASE}/counter`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            if (response.status === 401) {
                signOut();
                return;
            }
            throw new Error('Failed to load counter');
        }

        const data = await response.json();
        count = data.value;
        updateCountDisplay();
    } catch (error) {
        console.error('Error loading counter:', error);
    }
}

async function saveCount() {
    if (!authToken) return;

    try {
        const response = await fetch(`${API_BASE}/counter`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ value: count })
        });

        if (!response.ok) {
            if (response.status === 401) {
                signOut();
                return;
            }
            throw new Error('Failed to save counter');
        }
    } catch (error) {
        console.error('Error saving counter:', error);
    }
}

function updateCountDisplay() {
    const countElement = document.getElementById('count');
    if (countElement) {
        countElement.textContent = count;
        countElement.classList.add('updated');
        setTimeout(() => {
            countElement.classList.remove('updated');
        }, 200);
    }
}

async function updateCount(newValue) {
    count = newValue;
    updateCountDisplay();
    await saveCount();
}

document.addEventListener('DOMContentLoaded', () => {
    const storedToken = localStorage.getItem('authToken');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
        authToken = storedToken;
        currentUser = JSON.parse(storedUser);
    }

    updateUI();

    const tabSignup = document.getElementById('tab-signup');
    const tabSignin = document.getElementById('tab-signin');
    const signupForm = document.getElementById('signup-form');
    const signinForm = document.getElementById('signin-form');
    const signupFormElement = document.getElementById('signup-form-element');
    const signinFormElement = document.getElementById('signin-form-element');
    const signoutBtn = document.getElementById('signout');
    const incrementBtn = document.getElementById('increment');
    const decrementBtn = document.getElementById('decrement');
    const resetBtn = document.getElementById('reset');

    tabSignup?.addEventListener('click', () => {
        tabSignup.classList.add('active');
        tabSignin.classList.remove('active');
        signupForm.style.display = 'block';
        signinForm.style.display = 'none';
        clearMessages();
    });

    tabSignin?.addEventListener('click', () => {
        tabSignin.classList.add('active');
        tabSignup.classList.remove('active');
        signinForm.style.display = 'block';
        signupForm.style.display = 'none';
        clearMessages();
    });

    signupFormElement?.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();

        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;

        if (!email || !password) {
            showMessage('signup-error', 'Please fill in all fields', true);
            return;
        }

        try {
            await signUp(email, password);
            signupFormElement.reset();
        } catch (error) {
            showMessage('signup-error', error.message, true);
        }
    });

    signinFormElement?.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();

        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;

        if (!email || !password) {
            showMessage('signin-error', 'Please fill in all fields', true);
            return;
        }

        try {
            await signIn(email, password);
            signinFormElement.reset();
        } catch (error) {
            showMessage('signin-error', error.message, true);
        }
    });

    signoutBtn?.addEventListener('click', () => {
        signOut();
    });

    incrementBtn?.addEventListener('click', () => {
        updateCount(count + 1);
    });

    decrementBtn?.addEventListener('click', () => {
        updateCount(count - 1);
    });

    resetBtn?.addEventListener('click', () => {
        updateCount(0);
    });
});
