import { body, ValidationChain } from "express-validator";

export const validateRegister: ValidationChain[] = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email")
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("role")
    .isIn(["super-admin", "tenant-admin", "agent", "customer"])
    .withMessage("Invalid role"),
];

export const validateLogin: ValidationChain[] = [
  body("email")
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email"),
  body("password").notEmpty().withMessage("Password is required"),
];

export const validateTicket: ValidationChain[] = [
  body("title").trim().notEmpty().withMessage("Title is required"),
  body("description").trim().notEmpty().withMessage("Description is required"),
  body("priority")
    .optional()
    .isIn(["Critical", "High", "Medium", "Low"])
    .withMessage("Invalid priority"),
  body("category")
    .optional()
    .isIn(["general", "technical", "billing", "feature", "bug", "account"])
    .withMessage("Invalid category"),
];

export const validateTenant: ValidationChain[] = [
  body("name").trim().notEmpty().withMessage("Tenant name is required"),
  body("email")
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email"),
  body("adminName")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Admin name is required if creating admin user"),
  body("adminPassword")
    .optional()
    .isLength({ min: 6 })
    .withMessage("Admin password must be at least 6 characters"),
];

