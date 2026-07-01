"use strict";

/**
 * scripts/seed-demo.js — cria um tenant de demonstração completo.
 * Rode com: npm run seed:demo
 *
 * Após rodar, acesse com:
 *   http://localhost:3000/?tenant=barbearia-modelo
 * (ou configure o subdominio barbearia-modelo.localhost se seu navegador suportar)
 */

const path = require("path");
const db = require(path.join(__dirname, "..", "db"));
const auth = require(path.join(__dirname, "..", "auth"));

async function main() {
  db.applySchema();

  const slug = "barbearia-modelo";
  if (db.slugExists(slug)) {
    console.log(`Tenant "${slug}" ja existe. Nada a fazer.`);
    return;
  }

  const tenant = db.createTenant({
    name: "Barbearia Modelo",
    slug,
    notifyEmail: "contato@barbeariamodelo.com",
  });

  db.updateSettings(tenant.id, {});

  // Atualiza dados institucionais (createTenant só seta os campos básicos)
  db.getConnection().prepare(`
    UPDATE tenants SET slogan = ?, phone = ?, address = ?, opening_hours = ? WHERE id = ?
  `).run(
    "Cortes, barba e cuidado masculino com horario marcado.",
    "(11) 99999-0000",
    "Rua Exemplo, 123 - Sao Paulo, SP",
    "Segunda a sabado, das 9h as 20h",
    tenant.id
  );

  const adminHash = await auth.hashPassword("Admin@123");
  const gerenteHash = await auth.hashPassword("Gerente@123");
  const barbeiroHash = await auth.hashPassword("Barbeiro@123");

  const admin = db.createUser(tenant.id, { name: "Administrador", email: "admin@barbeariamodelo.com", passwordHash: adminHash, role: "admin", commissionRate: 0 });
  db.createUser(tenant.id, { name: "Gerente", email: "gerente@barbeariamodelo.com", passwordHash: gerenteHash, role: "gerente", commissionRate: 0.05 });
  const barbeiro = db.createUser(tenant.id, { name: "Carlos Barbeiro", email: "barbeiro@barbeariamodelo.com", passwordHash: barbeiroHash, role: "barbeiro", commissionRate: 0.4 });

  const corte = db.createService(tenant.id, { name: "Corte masculino", price: 45, duration: 40 });
  db.createService(tenant.id, { name: "Barba completa", price: 35, duration: 30 });
  const combo = db.createService(tenant.id, { name: "Corte + barba", price: 75, duration: 70 });

  db.createProduct(tenant.id, { name: "Pomada modeladora", barcode: "789100000001", quantity: 12, minQuantity: 4, unitCost: 22, salePrice: 39 });
  db.createProduct(tenant.id, { name: "Shampoo barba", barcode: "789100000002", quantity: 8, minQuantity: 3, unitCost: 18, salePrice: 32 });
  db.createProduct(tenant.id, { name: "Lamina descartavel", barcode: "789100000003", quantity: 40, minQuantity: 15, unitCost: 1.5, salePrice: 0 });

  db.createAppointment(tenant.id, {
    clientName: "Joao Silva",
    clientPhone: "(11) 98888-1111",
    clientEmail: "",
    serviceId: combo.id,
    barberId: barbeiro.id,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: "10:00",
    status: "agendado",
    publicRequest: true,
  });

  db.createSale(tenant.id, {
    date: new Date().toISOString().slice(0, 10),
    clientName: "Cliente Balcao",
    barberId: barbeiro.id,
    paymentMethod: "pix",
    items: [{ type: "service", refId: corte.id, name: corte.name, quantity: 1, unitPrice: corte.price }],
  });

  db.createPayable(tenant.id, { description: "Aluguel", dueDate: "2026-07-05", amount: 1800, status: "pendente" });
  db.createPayable(tenant.id, { description: "Fornecedor de cosmeticos", dueDate: "2026-07-10", amount: 650, status: "pendente" });

  console.log("Tenant de demonstracao criado com sucesso!\n");
  console.log(`Acesse: http://localhost:3000/?tenant=${slug}\n`);
  console.log("Credenciais de teste:");
  console.log("  Admin:    admin@barbeariamodelo.com    / Admin@123");
  console.log("  Gerente:  gerente@barbeariamodelo.com  / Gerente@123");
  console.log("  Barbeiro: barbeiro@barbeariamodelo.com / Barbeiro@123");
}

module.exports = { seedDemoTenant: main };

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Erro ao gerar seed de demonstracao:", err);
      process.exit(1);
    });
}
