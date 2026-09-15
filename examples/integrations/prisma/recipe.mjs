/** @param {import('@prisma/client').PrismaClient} prisma */
export function prismaNotes(prisma) {
  /** Customer identity is supplied by verified server authentication, not tool arguments.
   * @param {string} verifiedCustomerId */
  return async (verifiedCustomerId) => {
    if (!verifiedCustomerId) throw new Error('Customer authentication is required.');
    return prisma.customerNote.findMany({
      where: { customerId: verifiedCustomerId },
      select: { id: true, title: true, body: true },
      orderBy: { id: 'asc' },
      take: 20,
    });
  };
}
