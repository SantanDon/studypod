# Bugfix Requirements Document

## Introduction

The authentication system in StudyPodLM has critical inconsistencies where signed-in users are incorrectly treated as guests, authentication state is not properly unified across two auth systems (legacy email/password and encryption PIN/passphrase), and sign-out functionality leaves residual state. This causes authenticated users to see guest limit dialogs, incorrect profile information, and broken navigation flows.

The bug stems from having two separate authentication systems that aren't properly coordinated, with components checking different auth states inconsistently.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user is signed in via the encryption system (isUnlocked = true) but not via legacy auth (isAuthenticated = false) THEN the system incorrectly treats them as a guest and shows guest limit dialogs

1.2 WHEN a user is authenticated THEN the ProfileMenu displays "Not signed in" even though the user's username is shown

1.3 WHEN a user clicks the "Sign Up Free" button in AuthPrompt THEN the button does not navigate to the /auth page

1.4 WHEN a user clicks the "Sign In" button in AuthPrompt THEN the button does not navigate to the /auth page

1.5 WHEN a user clicks "Sign out" in ProfileMenu THEN the system does not clear all authentication state from both auth systems

1.6 WHEN a user signs out THEN the system does not navigate to the /auth page

1.7 WHEN components check authentication status THEN different components use different auth hooks (useAuth vs useEncryption) leading to inconsistent state detection

### Expected Behavior (Correct)

2.1 WHEN a user is signed in via either the legacy auth system OR the encryption system THEN the system SHALL recognize them as authenticated and NOT show guest limit dialogs

2.2 WHEN a user is authenticated THEN the ProfileMenu SHALL display the correct user information and show "Sign out" option with accurate authentication status

2.3 WHEN a user clicks the "Sign Up Free" button in AuthPrompt THEN the system SHALL navigate to the /auth page

2.4 WHEN a user clicks the "Sign In" button in AuthPrompt THEN the system SHALL navigate to the /auth page

2.5 WHEN a user clicks "Sign out" in ProfileMenu THEN the system SHALL clear all authentication state from both the legacy auth system AND the encryption system

2.6 WHEN a user signs out THEN the system SHALL navigate to the /auth page

2.7 WHEN components check authentication status THEN the system SHALL use a unified auth state that considers both auth systems

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user who has never signed in accesses the application THEN the system SHALL CONTINUE TO treat them as a guest and show appropriate guest limit dialogs

3.2 WHEN a user is in guest mode and reaches usage limits THEN the system SHALL CONTINUE TO show the AuthPrompt with "Sign Up Free" and "Sign In" options

3.3 WHEN a user successfully signs in THEN the system SHALL CONTINUE TO unlock all premium features and remove usage limits

3.4 WHEN a user's authentication session is valid THEN the system SHALL CONTINUE TO persist their authenticated state across page refreshes

3.5 WHEN a user navigates through the application while authenticated THEN the system SHALL CONTINUE TO maintain their authentication state without requiring re-authentication

3.6 WHEN a user has data stored locally THEN sign out SHALL CONTINUE TO preserve their encrypted data (only clear auth state, not user data)
