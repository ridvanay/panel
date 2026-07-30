import Stripe from "stripe";
import { env } from "../config/env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY || "sk_test_placeholder");
