/**
 * Security Isolation Test Script
 * 
 * This script tests cross-tenant data isolation to verify:
 * 1. Users cannot access resources from other companies
 * 2. Secure methods return null/undefined for unauthorized access
 * 3. Company scoping is enforced at the storage layer
 * 
 * Run with: npx tsx server/security/isolation-test.ts
 */

import { storage } from '../storage';
import { db } from '../db';
import { users, companies, companyMembers, jobs, invoices, documents, customers, estimates } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

interface TestResult {
  test: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function log(test: string, passed: boolean, message: string) {
  results.push({ test, passed, message });
  const icon = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m ${test}: ${message}`);
}

async function runIsolationTests() {
  console.log('\n========================================');
  console.log('SECURITY ISOLATION TEST SUITE');
  console.log('========================================\n');

  try {
    // Get two different companies from the database
    const allCompanies = await db.select().from(companies).limit(2);
    
    if (allCompanies.length < 2) {
      console.log('⚠ Need at least 2 companies to run isolation tests. Skipping...');
      return;
    }

    const company1 = allCompanies[0];
    const company2 = allCompanies[1];

    console.log(`Testing isolation between Company ${company1.id} and Company ${company2.id}\n`);

    // ==========================================
    // JOB ISOLATION TESTS
    // ==========================================
    console.log('--- Job Isolation Tests ---');

    // Get a job from company 1
    const company1Jobs = await storage.getJobs(company1.id);
    if (company1Jobs.length > 0) {
      const job = company1Jobs[0];
      
      // Test: Company 1 can access their own job
      const ownJobResult = await storage.getJobSecure(job.id, company1.id);
      log(
        'Job - Own company access',
        ownJobResult !== null && ownJobResult !== undefined,
        ownJobResult ? `Company ${company1.id} can access job ${job.id}` : 'FAILED - Could not access own job'
      );

      // Test: Company 2 CANNOT access Company 1's job
      const crossTenantJobResult = await storage.getJobSecure(job.id, company2.id);
      log(
        'Job - Cross-tenant access blocked',
        crossTenantJobResult === null || crossTenantJobResult === undefined,
        crossTenantJobResult === null || crossTenantJobResult === undefined
          ? `Company ${company2.id} correctly denied access to job ${job.id}`
          : 'FAILED - Cross-tenant access allowed!'
      );
    } else {
      console.log('⚠ No jobs found for Company 1, skipping job tests');
    }

    // ==========================================
    // INVOICE ISOLATION TESTS
    // ==========================================
    console.log('\n--- Invoice Isolation Tests ---');

    // Get an invoice from company 1
    const company1Invoices = await storage.getInvoices(company1.id);
    if (company1Invoices.length > 0) {
      const invoice = company1Invoices[0];
      
      // Test: Company 1 can access their own invoice
      const ownInvoiceResult = await storage.getInvoiceSecure(invoice.id, company1.id);
      log(
        'Invoice - Own company access',
        ownInvoiceResult !== null && ownInvoiceResult !== undefined,
        ownInvoiceResult ? `Company ${company1.id} can access invoice ${invoice.id}` : 'FAILED - Could not access own invoice'
      );

      // Test: Company 2 CANNOT access Company 1's invoice
      const crossTenantInvoiceResult = await storage.getInvoiceSecure(invoice.id, company2.id);
      log(
        'Invoice - Cross-tenant access blocked',
        crossTenantInvoiceResult === null || crossTenantInvoiceResult === undefined,
        crossTenantInvoiceResult === null || crossTenantInvoiceResult === undefined
          ? `Company ${company2.id} correctly denied access to invoice ${invoice.id}`
          : 'FAILED - Cross-tenant access allowed!'
      );
    } else {
      console.log('⚠ No invoices found for Company 1, skipping invoice tests');
    }

    // ==========================================
    // DOCUMENT ISOLATION TESTS
    // ==========================================
    console.log('\n--- Document Isolation Tests ---');

    // Get a document from company 1
    const company1Docs = await storage.getDocuments(company1.id);
    if (company1Docs.length > 0) {
      const doc = company1Docs[0];
      
      // Test: Company 1 can access their own document
      const ownDocResult = await storage.getDocumentSecure(doc.id, company1.id);
      log(
        'Document - Own company access',
        ownDocResult !== null && ownDocResult !== undefined,
        ownDocResult ? `Company ${company1.id} can access document ${doc.id}` : 'FAILED - Could not access own document'
      );

      // Test: Company 2 CANNOT access Company 1's document
      const crossTenantDocResult = await storage.getDocumentSecure(doc.id, company2.id);
      log(
        'Document - Cross-tenant access blocked',
        crossTenantDocResult === null || crossTenantDocResult === undefined,
        crossTenantDocResult === null || crossTenantDocResult === undefined
          ? `Company ${company2.id} correctly denied access to document ${doc.id}`
          : 'FAILED - Cross-tenant access allowed!'
      );
    } else {
      console.log('⚠ No documents found for Company 1, skipping document tests');
    }

    // ==========================================
    // CUSTOMER ISOLATION TESTS
    // ==========================================
    console.log('\n--- Customer Isolation Tests ---');

    // Get a customer from company 1
    const company1Customers = await storage.getCustomers(company1.id);
    if (company1Customers.length > 0) {
      const customer = company1Customers[0];
      
      // Test: Company 1 can access their own customer
      const ownCustomerResult = await storage.getCustomerSecure(customer.id, company1.id);
      log(
        'Customer - Own company access',
        ownCustomerResult !== null && ownCustomerResult !== undefined,
        ownCustomerResult ? `Company ${company1.id} can access customer ${customer.id}` : 'FAILED - Could not access own customer'
      );

      // Test: Company 2 CANNOT access Company 1's customer
      const crossTenantCustomerResult = await storage.getCustomerSecure(customer.id, company2.id);
      log(
        'Customer - Cross-tenant access blocked',
        crossTenantCustomerResult === null || crossTenantCustomerResult === undefined,
        crossTenantCustomerResult === null || crossTenantCustomerResult === undefined
          ? `Company ${company2.id} correctly denied access to customer ${customer.id}`
          : 'FAILED - Cross-tenant access allowed!'
      );
    } else {
      console.log('⚠ No customers found for Company 1, skipping customer tests');
    }

    // ==========================================
    // ESTIMATE ISOLATION TESTS
    // ==========================================
    console.log('\n--- Estimate Isolation Tests ---');

    // Get an estimate from company 1
    const company1Estimates = await storage.getEstimatesByCompany(company1.id);
    if (company1Estimates.length > 0) {
      const estimate = company1Estimates[0];
      
      // Test: Company 1 can access their own estimate
      const ownEstimateResult = await storage.getEstimateSecure(estimate.id, company1.id);
      log(
        'Estimate - Own company access',
        ownEstimateResult !== null && ownEstimateResult !== undefined,
        ownEstimateResult ? `Company ${company1.id} can access estimate ${estimate.id}` : 'FAILED - Could not access own estimate'
      );

      // Test: Company 2 CANNOT access Company 1's estimate
      const crossTenantEstimateResult = await storage.getEstimateSecure(estimate.id, company2.id);
      log(
        'Estimate - Cross-tenant access blocked',
        crossTenantEstimateResult === null || crossTenantEstimateResult === undefined,
        crossTenantEstimateResult === null || crossTenantEstimateResult === undefined
          ? `Company ${company2.id} correctly denied access to estimate ${estimate.id}`
          : 'FAILED - Cross-tenant access allowed!'
      );
    } else {
      console.log('⚠ No estimates found for Company 1, skipping estimate tests');
    }

    // ==========================================
    // CLIENT ISOLATION TESTS
    // ==========================================
    console.log('\n--- Client Isolation Tests ---');

    // Get a client from company 1
    const company1Clients = await storage.getClients(company1.id);
    if (company1Clients.length > 0) {
      const client = company1Clients[0];
      
      // Test: Company 1 can access their own client
      const ownClientResult = await storage.getClientSecure(client.id, company1.id);
      log(
        'Client - Own company access',
        ownClientResult !== null && ownClientResult !== undefined,
        ownClientResult ? `Company ${company1.id} can access client ${client.id}` : 'FAILED - Could not access own client'
      );

      // Test: Company 2 CANNOT access Company 1's client
      const crossTenantClientResult = await storage.getClientSecure(client.id, company2.id);
      log(
        'Client - Cross-tenant access blocked',
        crossTenantClientResult === null || crossTenantClientResult === undefined,
        crossTenantClientResult === null || crossTenantClientResult === undefined
          ? `Company ${company2.id} correctly denied access to client ${client.id}`
          : 'FAILED - Cross-tenant access allowed!'
      );
    } else {
      console.log('⚠ No clients found for Company 1, skipping client tests');
    }

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('\n========================================');
    console.log('TEST SUMMARY');
    console.log('========================================');
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    console.log(`Total Tests: ${total}`);
    console.log(`\x1b[32mPassed: ${passed}\x1b[0m`);
    console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);
    
    if (failed > 0) {
      console.log('\n\x1b[31m⚠ SECURITY VULNERABILITIES DETECTED!\x1b[0m');
      console.log('The following tests failed:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.test}: ${r.message}`);
      });
      process.exit(1);
    } else {
      console.log('\n\x1b[32m✓ All security isolation tests passed!\x1b[0m');
    }

  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  }
}

// Run the tests
runIsolationTests()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
